import { Router } from 'express';
import crypto from 'node:crypto';
import { mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import { withTenant, withTenantTx, toRow } from '../db/mongo.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { uuidField } from '../lib/fields.js';
import { authRequired, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { isClientRole } from '../lib/rbac.js';
import { loadProjectForUser } from './projects.service.js';

export const documentsRouter = Router();
documentsRouter.use(authRequired);

const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'csv', 'txt', 'zip', 'dwg', 'ifc',
]);
/** Categories a client-organisation user may see in the portal. */
const CLIENT_VISIBLE_CATEGORIES = ['CERTIFICATE', 'APPROVAL', 'CLIENT_DELIVERABLE', 'PHOTO'];

const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try {
      await mkdir(config.storageDir, { recursive: true });
      cb(null, config.storageDir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (_req, file, cb) => {
    // Never trust the client filename for storage paths, only the extension
    // (allow-listed) survives; the original name is kept as metadata only.
    const ext = path.extname(file.originalname).slice(1).toLowerCase();
    cb(null, `${crypto.randomBytes(16).toString('hex')}${ext ? `.${ext}` : ''}`);
  },
});

function fileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname).slice(1).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    // NOTE: badRequest is a factory (not a class), never call it with `new`;
    // a thrown error inside this synchronous filter would crash the process.
    return cb(badRequest(`File type ".${ext}" is not permitted`, [
      { field: 'body.file', message: `Allowed types: ${[...ALLOWED_EXTENSIONS].join(', ')}` },
    ]));
  }
  cb(null, true);
}

const upload = multer({ storage, fileFilter, limits: { fileSize: config.uploadMaxBytes, files: 1 } });

documentsRouter.get(
  '/projects/:id/documents',
  validate(z.object({ params: z.object({ id: uuidField }) })),
  async (req, res, next) => {
    try {
      const rows = await withTenant(req.user.tenantId, async (db) => {
        await loadProjectForUser(db, req.user, req.data.params.id);
        const filter = { project_id: req.data.params.id };
        if (isClientRole(req.user.role)) filter.category = { $in: CLIENT_VISIBLE_CATEGORIES };
        const docs = await db.coll('documents').find(filter, { sort: { created_at: -1 } });
        return attachUploaderNames(db, docs);
      });
      res.json({ documents: rows });
    } catch (err) {
      next(err);
    }
  },
);

async function attachUploaderNames(db, docs) {
  const ids = [...new Set(docs.map((d) => d.uploaded_by).filter(Boolean))];
  const users = ids.length
    ? await db.coll('users').find({ _id: { $in: ids } }, { projection: { _id: 1, full_name: 1 } })
    : [];
  const uMap = new Map(users.map((u) => [u._id, u.full_name]));
  return docs.map((d) => ({
    ...toRow(d),
    uploader_name: d.uploaded_by ? (uMap.get(d.uploaded_by) ?? null) : null,
  }));
}

const uploadFields = upload.single('file');

const uploadSchema = z.object({
  body: z.object({
    projectId: uuidField,
    title: z.string().trim().min(2).max(200),
    category: z.enum([
      'REPORT', 'DRAWING', 'GEOTECH', 'CONTRACT', 'CERTIFICATE', 'APPROVAL',
      'CLIENT_DELIVERABLE', 'PHOTO', 'OTHER',
    ]),
    stageIndex: z.coerce.number().int().min(1).max(11).optional(),
  }),
});

documentsRouter.post('/', requireCapability('documents.write'), (req, res, next) => {
  uploadFields(req, res, (err) => {
    if (err) return next(err);
    next();
  });
}, validate(uploadSchema), async (req, res, next) => {
  const b = req.data.body;
  try {
    if (!req.file) {
      return next(badRequest('Attach a file to upload', [{ field: 'body.file', message: 'A file is required' }]));
    }
    const row = await withTenantTx(req.user.tenantId, async (db) => {
      await loadProjectForUser(db, req.user, b.projectId);
      const doc = await db.coll('documents').insertOne({
        project_id: b.projectId,
        category: b.category,
        title: b.title,
        file_name: req.file.originalname.slice(0, 200),
        storage_key: req.file.filename,
        mime_type: req.file.mimetype,
        size_bytes: req.file.size,
        stage_index: b.stageIndex ?? null,
        uploaded_by: req.user.id,
        created_at: new Date(),
      });
      await audit(db, {
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'document.uploaded',
        entity: 'document',
        entityId: doc._id,
        summary: `Document uploaded, ${b.title}`,
        detail: { category: b.category, size: req.file.size },
      });
      return doc;
    });
    res.status(201).json({ document: toRow(row) });
  } catch (err) {
    // Don't orphan the stored file if the row failed.
    unlink(path.join(config.storageDir, req.file?.filename ?? '_')).catch(() => {});
    next(err);
  }
});

documentsRouter.get(
  '/:id/download',
  validate(z.object({ params: z.object({ id: uuidField }) })),
  async (req, res, next) => {
    try {
      const doc = await withTenant(req.user.tenantId, async (db) => {
        const d = await db.coll('documents').findOne({ _id: req.data.params.id });
        if (!d) throw notFound('Document not found');
        if (isClientRole(req.user.role) && !CLIENT_VISIBLE_CATEGORIES.includes(d.category)) {
          throw notFound('Document not found');
        }
        // Confirm the requesting user can reach the parent project.
        await loadProjectForUser(db, req.user, d.project_id);
        return d;
      });
      if (!doc.storage_key) throw notFound('This record has no attached file (metadata only)');
      // resolve(): sendFile requires an absolute path; basename() blocks traversal.
      const filePath = path.resolve(config.storageDir, path.basename(doc.storage_key));
      try {
        await stat(filePath);
      } catch {
        throw notFound('Stored file is missing, contact your administrator');
      }
      res.setHeader('Content-Type', doc.mime_type ?? 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${doc.file_name.replaceAll('"', '')}"`);
      res.sendFile(filePath, (err) => {
        if (err && !res.headersSent) next(err);
      });
    } catch (err) {
      next(err);
    }
  },
);

documentsRouter.delete(
  '/:id',
  requireCapability('documents.delete'),
  validate(z.object({ params: z.object({ id: uuidField }) })),
  async (req, res, next) => {
    try {
      const doc = await withTenantTx(req.user.tenantId, async (db) => {
        const d = await db.coll('documents').findOneAndDelete({ _id: req.data.params.id });
        if (!d) throw notFound('Document not found');
        await audit(db, {
          actorId: req.user.id,
          actorRole: req.user.role,
          action: 'document.deleted',
          entity: 'document',
          entityId: req.data.params.id,
          summary: `Document deleted, ${d.title}`,
        });
        return d;
      });
      if (doc.storage_key) {
        unlink(path.join(config.storageDir, path.basename(doc.storage_key))).catch(() => {});
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

/** Global document register (Files screen). */
documentsRouter.get('/', async (req, res, next) => {
  try {
    const rows = await withTenant(req.user.tenantId, async (db) => {
      const filter = isClientRole(req.user.role) ? { category: { $in: CLIENT_VISIBLE_CATEGORIES } } : {};
      const docs = await db.coll('documents').find(filter, { sort: { created_at: -1 }, limit: 200 });
      const projectIds = [...new Set(docs.map((d) => d.project_id))];
      const projects = projectIds.length
        ? await db.coll('projects').find({ _id: { $in: projectIds } }, { projection: { _id: 1, name: 1 } })
        : [];
      const pMap = new Map(projects.map((p) => [p._id, p.name]));
      const withNames = await attachUploaderNames(db, docs);
      return withNames.map((d) => ({ ...d, project_name: pMap.get(d.project_id) ?? null }));
    });
    res.json({ documents: rows });
  } catch (err) {
    next(err);
  }
});

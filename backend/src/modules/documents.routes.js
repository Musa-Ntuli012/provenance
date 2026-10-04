import { Router } from 'express';
import crypto from 'node:crypto';
import { mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import { withTenant } from '../db/pool.js';
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
        const base = `SELECT d.*, u.full_name AS uploader_name FROM documents d
                        LEFT JOIN users u ON u.id = d.uploaded_by
                       WHERE d.project_id = $1`;
        if (isClientRole(req.user.role)) {
          return db.query(`${base} AND d.category = ANY($2::text[]) ORDER BY d.created_at DESC`, [
            req.data.params.id,
            CLIENT_VISIBLE_CATEGORIES,
          ]);
        }
        return db.query(`${base} ORDER BY d.created_at DESC`, [req.data.params.id]);
      });
      res.json({ documents: rows.rows });
    } catch (err) {
      next(err);
    }
  },
);

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
    const row = await withTenant(req.user.tenantId, async (db) => {
      await loadProjectForUser(db, req.user, b.projectId);
      const r = await db.query(
        `INSERT INTO documents (project_id, category, title, file_name, storage_key, mime_type, size_bytes, stage_index, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          b.projectId,
          b.category,
          b.title,
          req.file.originalname.slice(0, 200),
          req.file.filename,
          req.file.mimetype,
          req.file.size,
          b.stageIndex ?? null,
          req.user.id,
        ],
      );
      await audit(db, {
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'document.uploaded',
        entity: 'document',
        entityId: r.rows[0].id,
        summary: `Document uploaded, ${b.title}`,
        detail: { category: b.category, size: req.file.size },
      });
      return r.rows[0];
    });
    res.status(201).json({ document: row });
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
        const r = await db.query('SELECT * FROM documents WHERE id = $1', [req.data.params.id]);
        if (r.rowCount === 0) throw notFound('Document not found');
        const doc = r.rows[0];
        if (isClientRole(req.user.role) && !CLIENT_VISIBLE_CATEGORIES.includes(doc.category)) {
          throw notFound('Document not found');
        }
        // Confirm the requesting user can reach the parent project.
        await loadProjectForUser(db, req.user, doc.project_id);
        return doc;
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
      const doc = await withTenant(req.user.tenantId, async (db) => {
        const r = await db.query('DELETE FROM documents WHERE id = $1 RETURNING *', [req.data.params.id]);
        if (r.rowCount === 0) throw notFound('Document not found');
        await audit(db, {
          actorId: req.user.id,
          actorRole: req.user.role,
          action: 'document.deleted',
          entity: 'document',
          entityId: req.data.params.id,
          summary: `Document deleted, ${r.rows[0].title}`,
        });
        return r.rows[0];
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
    const rows = await withTenant(req.user.tenantId, (db) => {
      if (isClientRole(req.user.role)) {
        return db.query(
          `SELECT d.*, p.name AS project_name, u.full_name AS uploader_name
             FROM documents d JOIN projects p ON p.id = d.project_id
             LEFT JOIN users u ON u.id = d.uploaded_by
            WHERE d.category = ANY($1::text[])
            ORDER BY d.created_at DESC LIMIT 200`,
          [CLIENT_VISIBLE_CATEGORIES],
        );
      }
      return db.query(
        `SELECT d.*, p.name AS project_name, u.full_name AS uploader_name
           FROM documents d JOIN projects p ON p.id = d.project_id
           LEFT JOIN users u ON u.id = d.uploaded_by
          ORDER BY d.created_at DESC LIMIT 200`,
      );
    });
    res.json({ documents: rows.rows });
  } catch (err) {
    next(err);
  }
});

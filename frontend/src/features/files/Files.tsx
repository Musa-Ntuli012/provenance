import FilesTab from '../projects/ProjectDetail';

/** Global document register reuses the same table as the project tab. */
export default function Files() {
  return (
    <div>
      <div className="page-head">
        <div className="title-block">
          <span className="eyebrow">Records</span>
          <h1 className="display">Files</h1>
          <p className="sub">Every document across the portfolio, against its project and stage.</p>
        </div>
      </div>
      <FilesTab />
    </div>
  );
}

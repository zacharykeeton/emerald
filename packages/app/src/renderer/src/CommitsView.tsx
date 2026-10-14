import { CommitsPanel } from './CommitsPanel.tsx';
import { folderName } from './files-model.ts';
import { commitsFolder, tabQuery } from './tabs-model.ts';
import { setDocumentQuery, useUi } from './ui.ts';
import { commitsFromQuery, commitsQuery } from './view-state.ts';

// The Commits tab's Expand (M61): the same graph as a document tab in
// the strip, at full width, the way the activity card expands to a day.
// A document, not a file: nothing is read from disk but the folder's git
// log, which the panel fetches and watches as it does in the rail. No
// session sits behind the tab, so the branch line is the graph's own
// read of HEAD (as in an M52 pane).
//
// M9 fix 178: the tab starts as a snapshot of the rail's section, the
// state carried on its path as a query, and keeps its own state from
// then on, written back to the query as its settings change, so it
// survives a restart with the tab list and never follows the rail again.
export function CommitsView({ path }: { path: string }) {
  const folder = commitsFolder(path);
  const { tabs } = useUi();
  const query = tabQuery(tabs, path);
  const state = commitsFromQuery(query);
  return (
    <div className="file-view commits-view" data-path={path} data-folder={folder ?? undefined} data-query={query ?? undefined}>
      <div className="file-header">
        <span className="file-path commits-view-title" title={folder === null ? path : `The commits of ${folder}`}>
          Commits · {folder === null ? path : folderName(folder) || folder}
        </span>
      </div>
      <div className="commits-view-body">
        {folder !== null && (
          <CommitsPanel
            folder={folder}
            branch={null}
            createdAt={null}
            tick={0}
            graph={state.graph}
            onGraph={(graph) => setDocumentQuery(path, commitsQuery({ graph, rows: state.rows }))}
            rows={state.rows}
            onRows={(rows) => setDocumentQuery(path, commitsQuery({ graph: state.graph, rows }))}
          />
        )}
      </div>
    </div>
  );
}

import { RecordsScreen } from '../../shared/RecordsScreen';

import './records.css';

export function IdeaA() {
  return (
    <div className="legacy-records">
      <RecordsScreen title="Idea A" endpoint="/api/ideas/idea-a/records" />
    </div>
  );
}

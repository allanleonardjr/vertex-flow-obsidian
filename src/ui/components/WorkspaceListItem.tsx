// Example reusable wrapper for all workspace list items
export const WorkspaceListItem = ({
  statusBadge,
  title,
  metadata,
  progressBar,
}) => {
  return (
    <div className="flex flex-col p-3 mb-2 bg-[#2c2c2c] rounded-md border border-gray-700 hover:bg-[#333333] transition-colors">
      {/* Top Row: Title and Metadata */}
      <div className="flex flex-row items-center justify-between w-full">
        {/* Left Side: Status & Title */}
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="flex-shrink-0">{statusBadge}</div>
          <span className="font-semibold text-gray-100 truncate">{title}</span>
        </div>

        {/* Right Side: Metadata (Counts, Dates) */}
        <div className="flex items-center gap-4 text-sm text-gray-400 flex-shrink-0 ml-4">
          {metadata}
        </div>
      </div>

      {/* Bottom Row: Progress Bar (Optional) */}
      {progressBar && (
        <div className="mt-3 w-full pl-8">
          {/* pl-8 indents the bar to align with the text, bypassing the status badge */}
          {progressBar}
        </div>
      )}
    </div>
  );
};

import { PAGE_SIZE } from '../../hooks/usePagedList';

/** Under a long list: how many rows are showing, and a button for the next 50. */
export default function LoadMore({ shown, total, hasMore, loading, onMore, noun = 'rows' }: {
  shown: number;
  total: number;
  hasMore: boolean;
  loading: boolean;
  onMore: () => void;
  noun?: string;
}) {
  if (total === 0) return null;
  return (
    <div className="load-more">
      <span>Showing {shown} of {total} {noun}</span>
      {hasMore && (
        <button type="button" className="btn btn-secondary" onClick={onMore} disabled={loading}>
          {loading ? <span className="spinner" /> : `Load ${Math.min(PAGE_SIZE, total - shown)} more`}
        </button>
      )}
    </div>
  );
}

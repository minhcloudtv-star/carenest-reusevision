export function EmptyState({ message = 'Không có sự kiện phù hợp.' }: { message?: string }) {
  return <p className="empty-state">{message}</p>
}

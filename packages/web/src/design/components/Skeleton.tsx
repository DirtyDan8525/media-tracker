/** A loading placeholder block; shimmers unless reduced motion is on. Hidden from assistive tech. */
export function Skeleton({ width = '100%', height = 16, radius = 8 }: { width?: number | string; height?: number | string; radius?: number }) {
  return <div className="skeleton" aria-hidden="true" style={{ width, height, borderRadius: radius }} />;
}

/** A list-row-shaped skeleton (cover + two lines + rating), as on the phone list. */
export function SkeletonRow() {
  return (
    <div className="skeleton-row" aria-hidden="true">
      <Skeleton width={56} height={84} radius={10} />
      <div className="skeleton-row__lines"><Skeleton width="70%" height={15} /><Skeleton width="45%" height={13} /></div>
      <Skeleton width={50} height={36} radius={10} />
    </div>
  );
}

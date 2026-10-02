import DottedScroll from './DottedScroll';

/**
 * Shared admin page shell with the dotted vertical scroll indicator.
 * Fills AppLayout main edge-to-edge; page padding lives inside the scroll content.
 */
export default function AdminPageScroll({
  children,
  className = '',
  narrow = false,
  contentClassName = 'flex flex-col gap-4 sm:gap-6 select-none pb-2',
  scrollClassName = 'h-full w-full overflow-y-scroll scrollbar-hide',
  dataPage,
}) {
  const widthClass = narrow ? 'max-w-4xl' : 'max-w-7xl';

  return (
    <div
      data-page={dataPage}
      className={`flex h-full min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden ${className}`.trim()}
    >
      <DottedScroll
        className="min-h-0 w-full flex-1"
        scrollClassName={scrollClassName}
        contentClassName={`mx-auto w-full ${widthClass} px-4 pt-4 sm:px-6 sm:pt-6 ${contentClassName}`.trim()}
      >
        {children}
      </DottedScroll>
    </div>
  );
}

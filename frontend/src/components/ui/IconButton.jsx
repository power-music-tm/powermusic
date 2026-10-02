import HoverTip from './HoverTip';

/**
 * Icon-only button with an instant HoverTip. Pass `label` for both aria-label and tooltip.
 */
export default function IconButton({
  label,
  children,
  className = '',
  type = 'button',
  placement = 'bottom',
  tipClassName = '',
  ...props
}) {
  return (
    <HoverTip label={label} placement={placement} className={tipClassName}>
      <button
        type={type}
        aria-label={label}
        className={className}
        {...props}
      >
        {children}
      </button>
    </HoverTip>
  );
}

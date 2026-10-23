/**
 * The NTS logo. It is a picture on a white background, so it always sits on a white tile (which
 * also keeps it readable in dark mode).
 */
export function Logo({
  size = 'md',
  className = '',
}: {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}) {
  const height = { sm: 'h-8', md: 'h-10', lg: 'h-16', xl: 'h-28' }[size];
  return (
    <img
      src={size === 'xl' ? '/nts-logo.jpg' : '/nts-logo-small.jpg'}
      alt="NTS Transport"
      width={size === 'xl' ? 1200 : 400}
      height={size === 'xl' ? 512 : 171}
      className={`${height} w-auto rounded-md bg-white object-contain ${className}`}
    />
  );
}

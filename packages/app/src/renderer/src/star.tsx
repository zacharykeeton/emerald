// The eight-spoke star the history rows draw before their facts line,
// Anthropic's asterisk as four round-capped strokes through the centre.
// It is one module because the session mark (fix 80) and the Sessions
// tab (fix 83) draw the same star; the colour is the caller's, through
// currentColor. rotate turns it about the centre for the mark's frames.
export function StarGlyph({ size = 12, rotate = 0, className }: { size?: number; rotate?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path
        d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        transform={rotate === 0 ? undefined : `rotate(${rotate} 8 8)`}
      />
    </svg>
  );
}

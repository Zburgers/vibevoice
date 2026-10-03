export function TranscriptContent({ transcript, error }: { transcript: string | null; error: string | null }) {
  return <>
    <p>{transcript || (!error ? "No transcript captured yet." : null)}</p>
    {error && <p role="alert">{error}</p>}
  </>;
}

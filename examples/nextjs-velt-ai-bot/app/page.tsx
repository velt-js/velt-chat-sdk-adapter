export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem", maxWidth: 640 }}>
      <h1>Velt Chat SDK AI Bot</h1>
      <p>
        This example runs an <strong>AI</strong> Chat SDK bot on Velt comment
        threads. When a user @-mentions the bot, it reads the thread history,
        asks an LLM, and streams the reply back into the thread.
      </p>
      <p>
        The webhook endpoint is <code>/api/webhooks/velt</code>. Configure a Velt
        webhook pointing at it, enable the <code>comment.*</code> events, set
        your <code>ANTHROPIC_API_KEY</code>, then @-mention <strong>Velt Bot</strong>.
      </p>
    </main>
  );
}

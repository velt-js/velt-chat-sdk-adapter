export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem", maxWidth: 640 }}>
      <h1>Velt Chat SDK Bot</h1>
      <p>
        This example runs a Chat SDK bot on Velt comment threads. The webhook
        endpoint lives at <code>/api/webhooks/velt</code>.
      </p>
      <p>
        Configure a Velt webhook (Console → Configurations → Webhook Service)
        pointing at this endpoint, enable the <code>comment.*</code> events, then
        @-mention <strong>Velt Bot</strong> in any comment thread.
      </p>
    </main>
  );
}

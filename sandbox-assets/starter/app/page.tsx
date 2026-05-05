export default function Page() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        gap: 12,
        padding: 24,
      }}
    >
      <h1 style={{ margin: 0 }}>Moncode</h1>
      <p style={{ margin: 0, opacity: 0.7 }}>
        Send a chat message to start vibe-coding a Monad dApp.
      </p>
    </main>
  );
}

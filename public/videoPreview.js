(function initVideoPreview() {
  const video = document.getElementById("unityPreviewVideo");
  const hint = document.getElementById("videoLoadHint");
  if (!video || !hint) return;

  function showHint(message) {
    hint.hidden = false;
    hint.textContent = message;
  }

  const host = window.location.hostname;
  const isLocalHost = host === "localhost" || host === "127.0.0.1";

  if (!isLocalHost) {
    showHint("Preview video is local-only. Open this dashboard from http://localhost:3000 to view it, or upload the MP4 to S3 and I can wire it for Vercel.");
  }

  video.addEventListener("error", () => {
    if (isLocalHost) {
      showHint("Video file was not found locally. Keep the MP4 in the project root and run the app with the local server.");
      return;
    }

    showHint("Video is not deployed on this host. Use localhost for local preview, or provide a hosted MP4 URL.");
  });
})();

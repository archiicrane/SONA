(function initVideoPreview() {
  const video = document.getElementById("unityPreviewVideo");
  const hint = document.getElementById("videoLoadHint");
  if (!video || !hint) return;

  const hostedPreviewUrl = "https://sona-data-kelly.s3.us-east-1.amazonaws.com/My+project+-+SampleScene+-+Web+-+Unity+6.3+LTS+(6000.3.11f1)+_DX12_+2026-04-23+03-08-04.mp4";

  function showHint(message) {
    hint.hidden = false;
    hint.textContent = message;
  }

  hint.hidden = true;
  video.src = hostedPreviewUrl;

  video.addEventListener("error", () => {
    showHint("Video failed to load from S3. Check object URL, object permissions, and CORS settings.");
  });
})();

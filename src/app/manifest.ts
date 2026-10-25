import type { MetadataRoute } from "next";
import { APP_NAME, APP_TAGLINE } from "../shared/copy/app";

/**
 * PWA 매니페스트. 송출 화면은 테마와 무관하게 항상 검정이므로 테마·배경색도 검정이다.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_TAGLINE,
    lang: "ko",
    start_url: "/presentations",
    scope: "/",
    display: "standalone",
    orientation: "landscape",
    theme_color: "#09090b",
    background_color: "#09090b",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

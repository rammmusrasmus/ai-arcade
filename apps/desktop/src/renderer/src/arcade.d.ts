import type { ArcadeApi } from "../../preload/index";

declare global {
  interface Window {
    arcade: ArcadeApi;
  }
}

export {};

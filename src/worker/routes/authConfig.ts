import { Hono } from "hono";
import type { AppEnv } from "../types";
import { configuredSocialProviders } from "../lib/auth";

/** 로그인 화면이 보여 줄 소셜 프로바이더. 자격증명이 설정된 것만 알려 준다. */
export const authConfigRoute = new Hono<AppEnv>().get("/auth-config", (c) => {
  return c.json({ providers: configuredSocialProviders(c.env) }, 200);
});

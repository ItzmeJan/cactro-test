import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "./config";
import { authRoutes } from "./routes/auth";
import { bookingRoutes } from "./routes/bookings";
import { eventRoutes, organizerRoutes } from "./routes/events";
import type { AppEnv } from "./types";

export const app = new Hono<AppEnv>();

app.use(
  "*",
  cors({
    origin: config.corsOrigin,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
  }),
);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.route("/auth", authRoutes);
app.route("/events", eventRoutes);
app.route("/organizer", organizerRoutes);
app.route("/", bookingRoutes);

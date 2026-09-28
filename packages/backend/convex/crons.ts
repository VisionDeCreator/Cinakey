import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "purge rejected takes",
  { hourUTC: 6, minuteUTC: 0 },
  internal.takes.purgeRejectedTakes,
  {},
);

export default crons;

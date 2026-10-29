import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
const crons = cronJobs();
// Worker outage detection must run independently of the worker itself.
crons.interval(
  "operations monitoring",
  { minutes: 1 },
  internal.adminOperations.evaluate,
  {},
);
crons.interval(
  "analytics report retention",
  { hours: 1 },
  internal.adminAnalytics.expire,
  {},
);
export default crons;

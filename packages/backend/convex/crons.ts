import { cronJobs } from "convex/server";
// Application retention scheduling is owned by the Bun worker.
export default cronJobs();

import * as transforms from "./transforms";
import * as email from "./email";
import * as entities from "./entities";
import * as generation from "./generation";
import * as workspace from "./workspace";

import * as promptSheets from "./promptSheets";
import * as staging from "./staging";
import * as storage from "./storage";
import * as timelineVersions from "./timelineVersions";
export const services = {
  transforms,
  workspace,
  email,
  entities,
  generation,

  promptSheets,
  staging,
  storage,
  timelineVersions,
};

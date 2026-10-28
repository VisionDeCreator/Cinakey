import { deleteObject, removeAbandonedUpload } from "./r2Storage";
import * as payments from "./payments";
import * as publishedExports from "./publishedExports";
import * as exportSharing from "./exportSharing";
import * as teamOnboarding from "./teamOnboarding";
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
  r2Storage: { deleteObject, removeAbandonedUpload },
  payments,
  publishedExports,
  exportSharing,
  teamOnboarding,
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

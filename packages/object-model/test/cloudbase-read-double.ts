// The gateway read doubles live with the database package's testing entry so
// every package's differential tests share them.
export {
  createCloudBaseLiveReader as liveReader,
  createCloudBaseSnapshotReader as snapshotClient,
} from "@livtales/db/testing";

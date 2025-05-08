export const SERVICE_KEY = {
  DMB_API: "dmb_api_service",
  DMB_FE: "dmb_frontend",
  CLI_DEBRID: "cli_debrid",
  CLI_BATTERY: "cli_battery",
  PHALANX_DB: "phalanx_db",
  PLEX_DEBRID: "plex_debrid",
  POSTGRESS: "postgres",
  PGADMIN: "pgadmin",
  RCLONE: "rclone",
  RIVEN_BE: "riven_backend",
  RIVEN_FE: "riven_frontend",
  ZILEAN: "zilean",
  ZURG: "zurg"
}

export const SERVICE_ACTIONS = {
  START: 1,
  STOP: 2,
  RESTART: 3,
}

export const PROCESS_STATUS = {
  RUNNING:'running',
  STOPPED:'stopped',
  UNKNOWN:'unknown',
}

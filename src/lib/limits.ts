/**
 * Largest file the app accepts in one request: attachments, imports, GSTR-2B files and backups.
 * Vercel functions reject request bodies over about 4.5 MB before the app sees them, so the app
 * stops at 4 MB and says so clearly. Large phone photos are shrunk in the browser before upload.
 */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_FILE_LABEL = "4 MB";

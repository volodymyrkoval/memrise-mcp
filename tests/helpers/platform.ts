/**
 * Windows neither enforces POSIX permission bits nor reports them from `stat`, and `chmod` there
 * only toggles the read-only flag. Tests about file modes, or that use `chmod` to make a file
 * unreadable or a folder unwritable, run on macOS and Linux only.
 */
export const POSIX_MODES_UNSUPPORTED = process.platform === 'win32';

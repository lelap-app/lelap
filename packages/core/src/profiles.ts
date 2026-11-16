/** The one profile every install starts with; M9 adds more. */
export const DEFAULT_PROFILE_ID = '00000000-0000-7000-8000-000000000001';

/** The profile whose library is shown. Always the default profile until M9. */
export function currentProfileId(): string {
  return DEFAULT_PROFILE_ID;
}

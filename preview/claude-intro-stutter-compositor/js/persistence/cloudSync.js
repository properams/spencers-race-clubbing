// js/persistence/cloudSync.js — placeholder for future cloud save / sign-in.
// ES module. Defines the API surface a real adapter (Supabase, Firebase, …)
// would implement so the Account UI can already wire its disabled button to
// the right hook. All methods currently no-op or throw.
//
// Future adapter responsibilities:
//   isCloudEnabled()    -> true once configured + signed in
//   signIn(provider)    -> resolves with a user object
//   signOut()           -> resolves once tokens are cleared
//   pushSnapshot(snap)  -> uploads (uses snapshot.getSaveSnapshot output)
//   pullSnapshot()      -> resolves with snapshot to feed applySaveSnapshot
//
// Conflict policy when both sides have changes: keep the snapshot with the
// newer exportedAt and offer the loser as a downloadable backup.

const NOT_IMPL = 'Cloud sync is nog niet beschikbaar. Gebruik export/import om je save mee te nemen.';

function isCloudEnabled(){ return false; }
function isSignedIn()    { return false; }
function currentUser()   { return null; }
function signIn()        { return Promise.reject(new Error(NOT_IMPL)); }
function signOut()       { return Promise.reject(new Error(NOT_IMPL)); }
function pushSnapshot()  { return Promise.reject(new Error(NOT_IMPL)); }
function pullSnapshot()  { return Promise.reject(new Error(NOT_IMPL)); }

const CloudSync = { isCloudEnabled, isSignedIn, currentUser,
                    signIn, signOut, pushSnapshot, pullSnapshot };

window.CloudSync = CloudSync;

export { CloudSync, isCloudEnabled, isSignedIn, currentUser,
         signIn, signOut, pushSnapshot, pullSnapshot };

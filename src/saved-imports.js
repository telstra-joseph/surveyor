let database;

function openDatabase() {
  return database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('surveyor-imports', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('imports');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(error => {
    database = undefined;
    throw error;
  });
}

async function transfer(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('imports', mode);
    const request = operation(transaction.objectStore('imports'));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error || request.error || new Error('Storage transaction cancelled.'));
  });
}

export const loadImports = () => transfer('readonly', store => store.get('workspace'));
export const saveImports = imports => transfer('readwrite', store => imports
  ? store.put(imports, 'workspace') : store.delete('workspace'));

export const loadWorkspace = () => transfer('readonly', store => store.get('manual-workspace'));
export const saveWorkspace = workspace => transfer('readwrite', store => store.put(workspace, 'manual-workspace'));

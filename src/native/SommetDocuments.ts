import { NativeEventEmitter, NativeModules } from 'react-native';

export type SharedGpx = { path: string } | { error: string };

const documents: {
  pickGpxFile(): Promise<string>;
  takeSharedGpxFiles(): Promise<SharedGpx[]>;
  addListener(eventType: string): void;
  removeListeners(count: number): void;
} = NativeModules.SommetDocuments;

export function pickGpxDocument() {
  return documents.pickGpxFile();
}

export function observeSharedGpx(onFile: (file: SharedGpx) => void) {
  let active = true;
  function drain() {
    documents.takeSharedGpxFiles().then(files => {
      if (active) files.forEach(onFile);
    }).catch(error => console.warn('Unable to read the GPX inbox', error));
  }
  const subscription = new NativeEventEmitter(documents).addListener('sharedGpxAvailable', drain);
  drain();
  return () => {
    active = false;
    subscription.remove();
  };
}

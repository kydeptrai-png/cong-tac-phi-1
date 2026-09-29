/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// If the loader is already loaded, just stop.
if (!self.define) {
  let registry = {};

  // Used for `eval` and `importScripts` where we can't get script URL by other means.
  // In both cases, it's safe to use a global var because those functions are synchronous.
  let nextDefineUri;

  const singleRequire = (uri, parentUri) => {
    uri = new URL(uri + ".js", parentUri).href;
    return registry[uri] || (
      
        new Promise(resolve => {
          if ("document" in self) {
            const script = document.createElement("script");
            script.src = uri;
            script.onload = resolve;
            document.head.appendChild(script);
          } else {
            nextDefineUri = uri;
            importScripts(uri);
            resolve();
          }
        })
      
      .then(() => {
        let promise = registry[uri];
        if (!promise) {
          throw new Error(`Module ${uri} didn’t register its module`);
        }
        return promise;
      })
    );
  };

  self.define = (depsNames, factory) => {
    const uri = nextDefineUri || ("document" in self ? document.currentScript.src : "") || location.href;
    if (registry[uri]) {
      // Module is already loading or loaded.
      return;
    }
    let exports = {};
    const require = depUri => singleRequire(depUri, uri);
    const specialDeps = {
      module: { uri },
      exports,
      require
    };
    registry[uri] = Promise.all(depsNames.map(
      depName => specialDeps[depName] || require(depName)
    )).then(deps => {
      factory(...deps);
      return exports;
    });
  };
}
define(['./workbox-afac4cd2'], (function (workbox) { 'use strict';

  self.skipWaiting();
  workbox.clientsClaim();
  /**
   * The precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  workbox.precacheAndRoute([{
    "url": "registerSW.js",
    "revision": "1872c500de691dce40960bb85481de07"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "10bddac3cd2531f46f7a402fd6b3fafe"
  }, {
    "url": "pwa-512x512.png",
    "revision": "10bddac3cd2531f46f7a402fd6b3fafe"
  }, {
    "url": "pwa-192x192.png",
    "revision": "17f9d91391788c7496f88ab67d7277f9"
  }, {
    "url": "index.html",
    "revision": "197c027df6f7f02094160db27b1f00c2"
  }, {
    "url": "icon.svg",
    "revision": "41effea01c1e953674cd629628002e8a"
  }, {
    "url": "apple-touch-icon.png",
    "revision": "726cd7e33ffbaf313c4ae94ec37811fe"
  }, {
    "url": "fonts/Roboto-Regular.ttf",
    "revision": "efe7c387439d6e1c2260a145eead4b35"
  }, {
    "url": "fonts/Roboto-Bold.ttf",
    "revision": "a764bc1a238fac3f4e9169b33bf29d9f"
  }, {
    "url": "assets/index-cVcN7XpW.css",
    "revision": null
  }, {
    "url": "assets/index-C8pLfiuN.js",
    "revision": null
  }, {
    "url": "apple-touch-icon.png",
    "revision": "726cd7e33ffbaf313c4ae94ec37811fe"
  }, {
    "url": "icon.svg",
    "revision": "41effea01c1e953674cd629628002e8a"
  }, {
    "url": "pwa-192x192.png",
    "revision": "17f9d91391788c7496f88ab67d7277f9"
  }, {
    "url": "pwa-512x512.png",
    "revision": "10bddac3cd2531f46f7a402fd6b3fafe"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "10bddac3cd2531f46f7a402fd6b3fafe"
  }, {
    "url": "manifest.webmanifest",
    "revision": "9f85388dfbfa0d2dd090af3fbfe344d0"
  }], {});
  workbox.cleanupOutdatedCaches();
  workbox.registerRoute(new workbox.NavigationRoute(workbox.createHandlerBoundToURL("index.html")));
  workbox.registerRoute(/^https:\/\/fonts\.googleapis\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "google-fonts-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');
  workbox.registerRoute(/^https:\/\/fonts\.gstatic\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "gstatic-fonts-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');

}));

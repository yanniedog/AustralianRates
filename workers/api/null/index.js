var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../../node_modules/hono/dist/compose.js
var compose = /* @__PURE__ */ __name((middleware, onError, onNotFound) => {
  return (context, next) => {
    let index = -1;
    return dispatch(0);
    async function dispatch(i) {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;
      let res;
      let isError = false;
      let handler;
      if (middleware[i]) {
        handler = middleware[i][0][0];
        context.req.routeIndex = i;
      } else {
        handler = i === middleware.length && next || void 0;
      }
      if (handler) {
        try {
          res = await handler(context, () => dispatch(i + 1));
        } catch (err) {
          if (err instanceof Error && onError) {
            context.error = err;
            res = await onError(err, context);
            isError = true;
          } else {
            throw err;
          }
        }
      } else {
        if (context.finalized === false && onNotFound) {
          res = await onNotFound(context);
        }
      }
      if (res && (context.finalized === false || isError)) {
        context.res = res;
      }
      return context;
    }
    __name(dispatch, "dispatch");
  };
}, "compose");

// ../../node_modules/hono/dist/request/constants.js
var GET_MATCH_RESULT = /* @__PURE__ */ Symbol();

// ../../node_modules/hono/dist/utils/body.js
var parseBody = /* @__PURE__ */ __name(async (request, options = /* @__PURE__ */ Object.create(null)) => {
  const { all = false, dot = false } = options;
  const headers = request instanceof HonoRequest ? request.raw.headers : request.headers;
  const contentType = headers.get("Content-Type");
  if (contentType?.startsWith("multipart/form-data") || contentType?.startsWith("application/x-www-form-urlencoded")) {
    return parseFormData(request, { all, dot });
  }
  return {};
}, "parseBody");
async function parseFormData(request, options) {
  const formData = await request.formData();
  if (formData) {
    return convertFormDataToBodyData(formData, options);
  }
  return {};
}
__name(parseFormData, "parseFormData");
function convertFormDataToBodyData(formData, options) {
  const form = /* @__PURE__ */ Object.create(null);
  formData.forEach((value, key) => {
    const shouldParseAllValues = options.all || key.endsWith("[]");
    if (!shouldParseAllValues) {
      form[key] = value;
    } else {
      handleParsingAllValues(form, key, value);
    }
  });
  if (options.dot) {
    Object.entries(form).forEach(([key, value]) => {
      const shouldParseDotValues = key.includes(".");
      if (shouldParseDotValues) {
        handleParsingNestedValues(form, key, value);
        delete form[key];
      }
    });
  }
  return form;
}
__name(convertFormDataToBodyData, "convertFormDataToBodyData");
var handleParsingAllValues = /* @__PURE__ */ __name((form, key, value) => {
  if (form[key] !== void 0) {
    if (Array.isArray(form[key])) {
      ;
      form[key].push(value);
    } else {
      form[key] = [form[key], value];
    }
  } else {
    if (!key.endsWith("[]")) {
      form[key] = value;
    } else {
      form[key] = [value];
    }
  }
}, "handleParsingAllValues");
var handleParsingNestedValues = /* @__PURE__ */ __name((form, key, value) => {
  let nestedForm = form;
  const keys = key.split(".");
  keys.forEach((key2, index) => {
    if (index === keys.length - 1) {
      nestedForm[key2] = value;
    } else {
      if (!nestedForm[key2] || typeof nestedForm[key2] !== "object" || Array.isArray(nestedForm[key2]) || nestedForm[key2] instanceof File) {
        nestedForm[key2] = /* @__PURE__ */ Object.create(null);
      }
      nestedForm = nestedForm[key2];
    }
  });
}, "handleParsingNestedValues");

// ../../node_modules/hono/dist/utils/url.js
var splitPath = /* @__PURE__ */ __name((path) => {
  const paths = path.split("/");
  if (paths[0] === "") {
    paths.shift();
  }
  return paths;
}, "splitPath");
var splitRoutingPath = /* @__PURE__ */ __name((routePath) => {
  const { groups, path } = extractGroupsFromPath(routePath);
  const paths = splitPath(path);
  return replaceGroupMarks(paths, groups);
}, "splitRoutingPath");
var extractGroupsFromPath = /* @__PURE__ */ __name((path) => {
  const groups = [];
  path = path.replace(/\{[^}]+\}/g, (match2, index) => {
    const mark = `@${index}`;
    groups.push([mark, match2]);
    return mark;
  });
  return { groups, path };
}, "extractGroupsFromPath");
var replaceGroupMarks = /* @__PURE__ */ __name((paths, groups) => {
  for (let i = groups.length - 1; i >= 0; i--) {
    const [mark] = groups[i];
    for (let j = paths.length - 1; j >= 0; j--) {
      if (paths[j].includes(mark)) {
        paths[j] = paths[j].replace(mark, groups[i][1]);
        break;
      }
    }
  }
  return paths;
}, "replaceGroupMarks");
var patternCache = {};
var getPattern = /* @__PURE__ */ __name((label, next) => {
  if (label === "*") {
    return "*";
  }
  const match2 = label.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
  if (match2) {
    const cacheKey = `${label}#${next}`;
    if (!patternCache[cacheKey]) {
      if (match2[2]) {
        patternCache[cacheKey] = next && next[0] !== ":" && next[0] !== "*" ? [cacheKey, match2[1], new RegExp(`^${match2[2]}(?=/${next})`)] : [label, match2[1], new RegExp(`^${match2[2]}$`)];
      } else {
        patternCache[cacheKey] = [label, match2[1], true];
      }
    }
    return patternCache[cacheKey];
  }
  return null;
}, "getPattern");
var tryDecode = /* @__PURE__ */ __name((str, decoder2) => {
  try {
    return decoder2(str);
  } catch {
    return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match2) => {
      try {
        return decoder2(match2);
      } catch {
        return match2;
      }
    });
  }
}, "tryDecode");
var tryDecodeURI = /* @__PURE__ */ __name((str) => tryDecode(str, decodeURI), "tryDecodeURI");
var getPath = /* @__PURE__ */ __name((request) => {
  const url = request.url;
  const start = url.indexOf("/", url.indexOf(":") + 4);
  let i = start;
  for (; i < url.length; i++) {
    const charCode = url.charCodeAt(i);
    if (charCode === 37) {
      const queryIndex = url.indexOf("?", i);
      const hashIndex = url.indexOf("#", i);
      const end = queryIndex === -1 ? hashIndex === -1 ? void 0 : hashIndex : hashIndex === -1 ? queryIndex : Math.min(queryIndex, hashIndex);
      const path = url.slice(start, end);
      return tryDecodeURI(path.includes("%25") ? path.replace(/%25/g, "%2525") : path);
    } else if (charCode === 63 || charCode === 35) {
      break;
    }
  }
  return url.slice(start, i);
}, "getPath");
var getPathNoStrict = /* @__PURE__ */ __name((request) => {
  const result = getPath(request);
  return result.length > 1 && result.at(-1) === "/" ? result.slice(0, -1) : result;
}, "getPathNoStrict");
var mergePath = /* @__PURE__ */ __name((base, sub, ...rest) => {
  if (rest.length) {
    sub = mergePath(sub, ...rest);
  }
  return `${base?.[0] === "/" ? "" : "/"}${base}${sub === "/" ? "" : `${base?.at(-1) === "/" ? "" : "/"}${sub?.[0] === "/" ? sub.slice(1) : sub}`}`;
}, "mergePath");
var checkOptionalParameter = /* @__PURE__ */ __name((path) => {
  if (path.charCodeAt(path.length - 1) !== 63 || !path.includes(":")) {
    return null;
  }
  const segments = path.split("/");
  const results = [];
  let basePath = "";
  segments.forEach((segment) => {
    if (segment !== "" && !/\:/.test(segment)) {
      basePath += "/" + segment;
    } else if (/\:/.test(segment)) {
      if (/\?/.test(segment)) {
        if (results.length === 0 && basePath === "") {
          results.push("/");
        } else {
          results.push(basePath);
        }
        const optionalSegment = segment.replace("?", "");
        basePath += "/" + optionalSegment;
        results.push(basePath);
      } else {
        basePath += "/" + segment;
      }
    }
  });
  return results.filter((v, i, a) => a.indexOf(v) === i);
}, "checkOptionalParameter");
var _decodeURI = /* @__PURE__ */ __name((value) => {
  if (!/[%+]/.test(value)) {
    return value;
  }
  if (value.indexOf("+") !== -1) {
    value = value.replace(/\+/g, " ");
  }
  return value.indexOf("%") !== -1 ? tryDecode(value, decodeURIComponent_) : value;
}, "_decodeURI");
var _getQueryParam = /* @__PURE__ */ __name((url, key, multiple) => {
  let encoded;
  if (!multiple && key && !/[%+]/.test(key)) {
    let keyIndex2 = url.indexOf("?", 8);
    if (keyIndex2 === -1) {
      return void 0;
    }
    if (!url.startsWith(key, keyIndex2 + 1)) {
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    while (keyIndex2 !== -1) {
      const trailingKeyCode = url.charCodeAt(keyIndex2 + key.length + 1);
      if (trailingKeyCode === 61) {
        const valueIndex = keyIndex2 + key.length + 2;
        const endIndex = url.indexOf("&", valueIndex);
        return _decodeURI(url.slice(valueIndex, endIndex === -1 ? void 0 : endIndex));
      } else if (trailingKeyCode == 38 || isNaN(trailingKeyCode)) {
        return "";
      }
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    encoded = /[%+]/.test(url);
    if (!encoded) {
      return void 0;
    }
  }
  const results = {};
  encoded ??= /[%+]/.test(url);
  let keyIndex = url.indexOf("?", 8);
  while (keyIndex !== -1) {
    const nextKeyIndex = url.indexOf("&", keyIndex + 1);
    let valueIndex = url.indexOf("=", keyIndex);
    if (valueIndex > nextKeyIndex && nextKeyIndex !== -1) {
      valueIndex = -1;
    }
    let name = url.slice(
      keyIndex + 1,
      valueIndex === -1 ? nextKeyIndex === -1 ? void 0 : nextKeyIndex : valueIndex
    );
    if (encoded) {
      name = _decodeURI(name);
    }
    keyIndex = nextKeyIndex;
    if (name === "") {
      continue;
    }
    let value;
    if (valueIndex === -1) {
      value = "";
    } else {
      value = url.slice(valueIndex + 1, nextKeyIndex === -1 ? void 0 : nextKeyIndex);
      if (encoded) {
        value = _decodeURI(value);
      }
    }
    if (multiple) {
      if (!(results[name] && Array.isArray(results[name]))) {
        results[name] = [];
      }
      ;
      results[name].push(value);
    } else {
      results[name] ??= value;
    }
  }
  return key ? results[key] : results;
}, "_getQueryParam");
var getQueryParam = _getQueryParam;
var getQueryParams = /* @__PURE__ */ __name((url, key) => {
  return _getQueryParam(url, key, true);
}, "getQueryParams");
var decodeURIComponent_ = decodeURIComponent;

// ../../node_modules/hono/dist/request.js
var tryDecodeURIComponent = /* @__PURE__ */ __name((str) => tryDecode(str, decodeURIComponent_), "tryDecodeURIComponent");
var HonoRequest = class {
  static {
    __name(this, "HonoRequest");
  }
  /**
   * `.raw` can get the raw Request object.
   *
   * @see {@link https://hono.dev/docs/api/request#raw}
   *
   * @example
   * ```ts
   * // For Cloudflare Workers
   * app.post('/', async (c) => {
   *   const metadata = c.req.raw.cf?.hostMetadata?
   *   ...
   * })
   * ```
   */
  raw;
  #validatedData;
  // Short name of validatedData
  #matchResult;
  routeIndex = 0;
  /**
   * `.path` can get the pathname of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#path}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const pathname = c.req.path // `/about/me`
   * })
   * ```
   */
  path;
  bodyCache = {};
  constructor(request, path = "/", matchResult = [[]]) {
    this.raw = request;
    this.path = path;
    this.#matchResult = matchResult;
    this.#validatedData = {};
  }
  param(key) {
    return key ? this.#getDecodedParam(key) : this.#getAllDecodedParams();
  }
  #getDecodedParam(key) {
    const paramKey = this.#matchResult[0][this.routeIndex][1][key];
    const param = this.#getParamValue(paramKey);
    return param && /\%/.test(param) ? tryDecodeURIComponent(param) : param;
  }
  #getAllDecodedParams() {
    const decoded = {};
    const keys = Object.keys(this.#matchResult[0][this.routeIndex][1]);
    for (const key of keys) {
      const value = this.#getParamValue(this.#matchResult[0][this.routeIndex][1][key]);
      if (value !== void 0) {
        decoded[key] = /\%/.test(value) ? tryDecodeURIComponent(value) : value;
      }
    }
    return decoded;
  }
  #getParamValue(paramKey) {
    return this.#matchResult[1] ? this.#matchResult[1][paramKey] : paramKey;
  }
  query(key) {
    return getQueryParam(this.url, key);
  }
  queries(key) {
    return getQueryParams(this.url, key);
  }
  header(name) {
    if (name) {
      return this.raw.headers.get(name) ?? void 0;
    }
    const headerData = {};
    this.raw.headers.forEach((value, key) => {
      headerData[key] = value;
    });
    return headerData;
  }
  async parseBody(options) {
    return this.bodyCache.parsedBody ??= await parseBody(this, options);
  }
  #cachedBody = /* @__PURE__ */ __name((key) => {
    const { bodyCache, raw: raw2 } = this;
    const cachedBody = bodyCache[key];
    if (cachedBody) {
      return cachedBody;
    }
    const anyCachedKey = Object.keys(bodyCache)[0];
    if (anyCachedKey) {
      return bodyCache[anyCachedKey].then((body) => {
        if (anyCachedKey === "json") {
          body = JSON.stringify(body);
        }
        return new Response(body)[key]();
      });
    }
    return bodyCache[key] = raw2[key]();
  }, "#cachedBody");
  /**
   * `.json()` can parse Request body of type `application/json`
   *
   * @see {@link https://hono.dev/docs/api/request#json}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.json()
   * })
   * ```
   */
  json() {
    return this.#cachedBody("text").then((text) => JSON.parse(text));
  }
  /**
   * `.text()` can parse Request body of type `text/plain`
   *
   * @see {@link https://hono.dev/docs/api/request#text}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.text()
   * })
   * ```
   */
  text() {
    return this.#cachedBody("text");
  }
  /**
   * `.arrayBuffer()` parse Request body as an `ArrayBuffer`
   *
   * @see {@link https://hono.dev/docs/api/request#arraybuffer}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.arrayBuffer()
   * })
   * ```
   */
  arrayBuffer() {
    return this.#cachedBody("arrayBuffer");
  }
  /**
   * Parses the request body as a `Blob`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.blob();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#blob
   */
  blob() {
    return this.#cachedBody("blob");
  }
  /**
   * Parses the request body as `FormData`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.formData();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#formdata
   */
  formData() {
    return this.#cachedBody("formData");
  }
  /**
   * Adds validated data to the request.
   *
   * @param target - The target of the validation.
   * @param data - The validated data to add.
   */
  addValidatedData(target, data) {
    this.#validatedData[target] = data;
  }
  valid(target) {
    return this.#validatedData[target];
  }
  /**
   * `.url()` can get the request url strings.
   *
   * @see {@link https://hono.dev/docs/api/request#url}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const url = c.req.url // `http://localhost:8787/about/me`
   *   ...
   * })
   * ```
   */
  get url() {
    return this.raw.url;
  }
  /**
   * `.method()` can get the method name of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#method}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const method = c.req.method // `GET`
   * })
   * ```
   */
  get method() {
    return this.raw.method;
  }
  get [GET_MATCH_RESULT]() {
    return this.#matchResult;
  }
  /**
   * `.matchedRoutes()` can return a matched route in the handler
   *
   * @deprecated
   *
   * Use matchedRoutes helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#matchedroutes}
   *
   * @example
   * ```ts
   * app.use('*', async function logger(c, next) {
   *   await next()
   *   c.req.matchedRoutes.forEach(({ handler, method, path }, i) => {
   *     const name = handler.name || (handler.length < 2 ? '[handler]' : '[middleware]')
   *     console.log(
   *       method,
   *       ' ',
   *       path,
   *       ' '.repeat(Math.max(10 - path.length, 0)),
   *       name,
   *       i === c.req.routeIndex ? '<- respond from here' : ''
   *     )
   *   })
   * })
   * ```
   */
  get matchedRoutes() {
    return this.#matchResult[0].map(([[, route]]) => route);
  }
  /**
   * `routePath()` can retrieve the path registered within the handler
   *
   * @deprecated
   *
   * Use routePath helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#routepath}
   *
   * @example
   * ```ts
   * app.get('/posts/:id', (c) => {
   *   return c.json({ path: c.req.routePath })
   * })
   * ```
   */
  get routePath() {
    return this.#matchResult[0].map(([[, route]]) => route)[this.routeIndex].path;
  }
};

// ../../node_modules/hono/dist/utils/html.js
var HtmlEscapedCallbackPhase = {
  Stringify: 1,
  BeforeStream: 2,
  Stream: 3
};
var raw = /* @__PURE__ */ __name((value, callbacks) => {
  const escapedString = new String(value);
  escapedString.isEscaped = true;
  escapedString.callbacks = callbacks;
  return escapedString;
}, "raw");
var resolveCallback = /* @__PURE__ */ __name(async (str, phase, preserveCallbacks, context, buffer) => {
  if (typeof str === "object" && !(str instanceof String)) {
    if (!(str instanceof Promise)) {
      str = str.toString();
    }
    if (str instanceof Promise) {
      str = await str;
    }
  }
  const callbacks = str.callbacks;
  if (!callbacks?.length) {
    return Promise.resolve(str);
  }
  if (buffer) {
    buffer[0] += str;
  } else {
    buffer = [str];
  }
  const resStr = Promise.all(callbacks.map((c) => c({ phase, buffer, context }))).then(
    (res) => Promise.all(
      res.filter(Boolean).map((str2) => resolveCallback(str2, phase, false, context, buffer))
    ).then(() => buffer[0])
  );
  if (preserveCallbacks) {
    return raw(await resStr, callbacks);
  } else {
    return resStr;
  }
}, "resolveCallback");

// ../../node_modules/hono/dist/context.js
var TEXT_PLAIN = "text/plain; charset=UTF-8";
var setDefaultContentType = /* @__PURE__ */ __name((contentType, headers) => {
  return {
    "Content-Type": contentType,
    ...headers
  };
}, "setDefaultContentType");
var createResponseInstance = /* @__PURE__ */ __name((body, init) => new Response(body, init), "createResponseInstance");
var Context = class {
  static {
    __name(this, "Context");
  }
  #rawRequest;
  #req;
  /**
   * `.env` can get bindings (environment variables, secrets, KV namespaces, D1 database, R2 bucket etc.) in Cloudflare Workers.
   *
   * @see {@link https://hono.dev/docs/api/context#env}
   *
   * @example
   * ```ts
   * // Environment object for Cloudflare Workers
   * app.get('*', async c => {
   *   const counter = c.env.COUNTER
   * })
   * ```
   */
  env = {};
  #var;
  finalized = false;
  /**
   * `.error` can get the error object from the middleware if the Handler throws an error.
   *
   * @see {@link https://hono.dev/docs/api/context#error}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   await next()
   *   if (c.error) {
   *     // do something...
   *   }
   * })
   * ```
   */
  error;
  #status;
  #executionCtx;
  #res;
  #layout;
  #renderer;
  #notFoundHandler;
  #preparedHeaders;
  #matchResult;
  #path;
  /**
   * Creates an instance of the Context class.
   *
   * @param req - The Request object.
   * @param options - Optional configuration options for the context.
   */
  constructor(req, options) {
    this.#rawRequest = req;
    if (options) {
      this.#executionCtx = options.executionCtx;
      this.env = options.env;
      this.#notFoundHandler = options.notFoundHandler;
      this.#path = options.path;
      this.#matchResult = options.matchResult;
    }
  }
  /**
   * `.req` is the instance of {@link HonoRequest}.
   */
  get req() {
    this.#req ??= new HonoRequest(this.#rawRequest, this.#path, this.#matchResult);
    return this.#req;
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#event}
   * The FetchEvent associated with the current request.
   *
   * @throws Will throw an error if the context does not have a FetchEvent.
   */
  get event() {
    if (this.#executionCtx && "respondWith" in this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no FetchEvent");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#executionctx}
   * The ExecutionContext associated with the current request.
   *
   * @throws Will throw an error if the context does not have an ExecutionContext.
   */
  get executionCtx() {
    if (this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no ExecutionContext");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#res}
   * The Response object for the current request.
   */
  get res() {
    return this.#res ||= createResponseInstance(null, {
      headers: this.#preparedHeaders ??= new Headers()
    });
  }
  /**
   * Sets the Response object for the current request.
   *
   * @param _res - The Response object to set.
   */
  set res(_res) {
    if (this.#res && _res) {
      _res = createResponseInstance(_res.body, _res);
      for (const [k, v] of this.#res.headers.entries()) {
        if (k === "content-type") {
          continue;
        }
        if (k === "set-cookie") {
          const cookies = this.#res.headers.getSetCookie();
          _res.headers.delete("set-cookie");
          for (const cookie of cookies) {
            _res.headers.append("set-cookie", cookie);
          }
        } else {
          _res.headers.set(k, v);
        }
      }
    }
    this.#res = _res;
    this.finalized = true;
  }
  /**
   * `.render()` can create a response within a layout.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   return c.render('Hello!')
   * })
   * ```
   */
  render = /* @__PURE__ */ __name((...args) => {
    this.#renderer ??= (content) => this.html(content);
    return this.#renderer(...args);
  }, "render");
  /**
   * Sets the layout for the response.
   *
   * @param layout - The layout to set.
   * @returns The layout function.
   */
  setLayout = /* @__PURE__ */ __name((layout) => this.#layout = layout, "setLayout");
  /**
   * Gets the current layout for the response.
   *
   * @returns The current layout function.
   */
  getLayout = /* @__PURE__ */ __name(() => this.#layout, "getLayout");
  /**
   * `.setRenderer()` can set the layout in the custom middleware.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```tsx
   * app.use('*', async (c, next) => {
   *   c.setRenderer((content) => {
   *     return c.html(
   *       <html>
   *         <body>
   *           <p>{content}</p>
   *         </body>
   *       </html>
   *     )
   *   })
   *   await next()
   * })
   * ```
   */
  setRenderer = /* @__PURE__ */ __name((renderer) => {
    this.#renderer = renderer;
  }, "setRenderer");
  /**
   * `.header()` can set headers.
   *
   * @see {@link https://hono.dev/docs/api/context#header}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  header = /* @__PURE__ */ __name((name, value, options) => {
    if (this.finalized) {
      this.#res = createResponseInstance(this.#res.body, this.#res);
    }
    const headers = this.#res ? this.#res.headers : this.#preparedHeaders ??= new Headers();
    if (value === void 0) {
      headers.delete(name);
    } else if (options?.append) {
      headers.append(name, value);
    } else {
      headers.set(name, value);
    }
  }, "header");
  status = /* @__PURE__ */ __name((status) => {
    this.#status = status;
  }, "status");
  /**
   * `.set()` can set the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   c.set('message', 'Hono is hot!!')
   *   await next()
   * })
   * ```
   */
  set = /* @__PURE__ */ __name((key, value) => {
    this.#var ??= /* @__PURE__ */ new Map();
    this.#var.set(key, value);
  }, "set");
  /**
   * `.get()` can use the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   const message = c.get('message')
   *   return c.text(`The message is "${message}"`)
   * })
   * ```
   */
  get = /* @__PURE__ */ __name((key) => {
    return this.#var ? this.#var.get(key) : void 0;
  }, "get");
  /**
   * `.var` can access the value of a variable.
   *
   * @see {@link https://hono.dev/docs/api/context#var}
   *
   * @example
   * ```ts
   * const result = c.var.client.oneMethod()
   * ```
   */
  // c.var.propName is a read-only
  get var() {
    if (!this.#var) {
      return {};
    }
    return Object.fromEntries(this.#var);
  }
  #newResponse(data, arg, headers) {
    const responseHeaders = this.#res ? new Headers(this.#res.headers) : this.#preparedHeaders ?? new Headers();
    if (typeof arg === "object" && "headers" in arg) {
      const argHeaders = arg.headers instanceof Headers ? arg.headers : new Headers(arg.headers);
      for (const [key, value] of argHeaders) {
        if (key.toLowerCase() === "set-cookie") {
          responseHeaders.append(key, value);
        } else {
          responseHeaders.set(key, value);
        }
      }
    }
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        if (typeof v === "string") {
          responseHeaders.set(k, v);
        } else {
          responseHeaders.delete(k);
          for (const v2 of v) {
            responseHeaders.append(k, v2);
          }
        }
      }
    }
    const status = typeof arg === "number" ? arg : arg?.status ?? this.#status;
    return createResponseInstance(data, { status, headers: responseHeaders });
  }
  newResponse = /* @__PURE__ */ __name((...args) => this.#newResponse(...args), "newResponse");
  /**
   * `.body()` can return the HTTP response.
   * You can set headers with `.header()` and set HTTP status code with `.status`.
   * This can also be set in `.text()`, `.json()` and so on.
   *
   * @see {@link https://hono.dev/docs/api/context#body}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *   // Set HTTP status code
   *   c.status(201)
   *
   *   // Return the response body
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  body = /* @__PURE__ */ __name((data, arg, headers) => this.#newResponse(data, arg, headers), "body");
  #useFastPath() {
    return !this.#preparedHeaders && !this.#status && !this.finalized;
  }
  /**
   * `.text()` can render text as `Content-Type:text/plain`.
   *
   * @see {@link https://hono.dev/docs/api/context#text}
   *
   * @example
   * ```ts
   * app.get('/say', (c) => {
   *   return c.text('Hello!')
   * })
   * ```
   */
  text = /* @__PURE__ */ __name((text, arg, headers) => {
    return this.#useFastPath() && !arg && !headers ? createResponseInstance(text) : this.#newResponse(
      text,
      arg,
      setDefaultContentType(TEXT_PLAIN, headers)
    );
  }, "text");
  /**
   * `.json()` can render JSON as `Content-Type:application/json`.
   *
   * @see {@link https://hono.dev/docs/api/context#json}
   *
   * @example
   * ```ts
   * app.get('/api', (c) => {
   *   return c.json({ message: 'Hello!' })
   * })
   * ```
   */
  json = /* @__PURE__ */ __name((object, arg, headers) => {
    return this.#useFastPath() && !arg && !headers ? Response.json(object) : this.#newResponse(
      JSON.stringify(object),
      arg,
      setDefaultContentType("application/json", headers)
    );
  }, "json");
  html = /* @__PURE__ */ __name((html, arg, headers) => {
    const res = /* @__PURE__ */ __name((html2) => this.#newResponse(html2, arg, setDefaultContentType("text/html; charset=UTF-8", headers)), "res");
    return typeof html === "object" ? resolveCallback(html, HtmlEscapedCallbackPhase.Stringify, false, {}).then(res) : res(html);
  }, "html");
  /**
   * `.redirect()` can Redirect, default status code is 302.
   *
   * @see {@link https://hono.dev/docs/api/context#redirect}
   *
   * @example
   * ```ts
   * app.get('/redirect', (c) => {
   *   return c.redirect('/')
   * })
   * app.get('/redirect-permanently', (c) => {
   *   return c.redirect('/', 301)
   * })
   * ```
   */
  redirect = /* @__PURE__ */ __name((location, status) => {
    const locationString = String(location);
    this.header(
      "Location",
      // Multibyes should be encoded
      // eslint-disable-next-line no-control-regex
      !/[^\x00-\xFF]/.test(locationString) ? locationString : encodeURI(locationString)
    );
    return this.newResponse(null, status ?? 302);
  }, "redirect");
  /**
   * `.notFound()` can return the Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/context#notfound}
   *
   * @example
   * ```ts
   * app.get('/notfound', (c) => {
   *   return c.notFound()
   * })
   * ```
   */
  notFound = /* @__PURE__ */ __name(() => {
    this.#notFoundHandler ??= () => createResponseInstance();
    return this.#notFoundHandler(this);
  }, "notFound");
};

// ../../node_modules/hono/dist/router.js
var METHOD_NAME_ALL = "ALL";
var METHOD_NAME_ALL_LOWERCASE = "all";
var METHODS = ["get", "post", "put", "delete", "options", "patch"];
var MESSAGE_MATCHER_IS_ALREADY_BUILT = "Can not add a route since the matcher is already built.";
var UnsupportedPathError = class extends Error {
  static {
    __name(this, "UnsupportedPathError");
  }
};

// ../../node_modules/hono/dist/utils/constants.js
var COMPOSED_HANDLER = "__COMPOSED_HANDLER";

// ../../node_modules/hono/dist/hono-base.js
var notFoundHandler = /* @__PURE__ */ __name((c) => {
  return c.text("404 Not Found", 404);
}, "notFoundHandler");
var errorHandler = /* @__PURE__ */ __name((err, c) => {
  if ("getResponse" in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err);
  return c.text("Internal Server Error", 500);
}, "errorHandler");
var Hono = class _Hono {
  static {
    __name(this, "_Hono");
  }
  get;
  post;
  put;
  delete;
  options;
  patch;
  all;
  on;
  use;
  /*
    This class is like an abstract class and does not have a router.
    To use it, inherit the class and implement router in the constructor.
  */
  router;
  getPath;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  _basePath = "/";
  #path = "/";
  routes = [];
  constructor(options = {}) {
    const allMethods = [...METHODS, METHOD_NAME_ALL_LOWERCASE];
    allMethods.forEach((method) => {
      this[method] = (args1, ...args) => {
        if (typeof args1 === "string") {
          this.#path = args1;
        } else {
          this.#addRoute(method, this.#path, args1);
        }
        args.forEach((handler) => {
          this.#addRoute(method, this.#path, handler);
        });
        return this;
      };
    });
    this.on = (method, path, ...handlers) => {
      for (const p of [path].flat()) {
        this.#path = p;
        for (const m of [method].flat()) {
          handlers.map((handler) => {
            this.#addRoute(m.toUpperCase(), this.#path, handler);
          });
        }
      }
      return this;
    };
    this.use = (arg1, ...handlers) => {
      if (typeof arg1 === "string") {
        this.#path = arg1;
      } else {
        this.#path = "*";
        handlers.unshift(arg1);
      }
      handlers.forEach((handler) => {
        this.#addRoute(METHOD_NAME_ALL, this.#path, handler);
      });
      return this;
    };
    const { strict, ...optionsWithoutStrict } = options;
    Object.assign(this, optionsWithoutStrict);
    this.getPath = strict ?? true ? options.getPath ?? getPath : getPathNoStrict;
  }
  #clone() {
    const clone2 = new _Hono({
      router: this.router,
      getPath: this.getPath
    });
    clone2.errorHandler = this.errorHandler;
    clone2.#notFoundHandler = this.#notFoundHandler;
    clone2.routes = this.routes;
    return clone2;
  }
  #notFoundHandler = notFoundHandler;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  errorHandler = errorHandler;
  /**
   * `.route()` allows grouping other Hono instance in routes.
   *
   * @see {@link https://hono.dev/docs/api/routing#grouping}
   *
   * @param {string} path - base Path
   * @param {Hono} app - other Hono instance
   * @returns {Hono} routed Hono instance
   *
   * @example
   * ```ts
   * const app = new Hono()
   * const app2 = new Hono()
   *
   * app2.get("/user", (c) => c.text("user"))
   * app.route("/api", app2) // GET /api/user
   * ```
   */
  route(path, app2) {
    const subApp = this.basePath(path);
    app2.routes.map((r) => {
      let handler;
      if (app2.errorHandler === errorHandler) {
        handler = r.handler;
      } else {
        handler = /* @__PURE__ */ __name(async (c, next) => (await compose([], app2.errorHandler)(c, () => r.handler(c, next))).res, "handler");
        handler[COMPOSED_HANDLER] = r.handler;
      }
      subApp.#addRoute(r.method, r.path, handler);
    });
    return this;
  }
  /**
   * `.basePath()` allows base paths to be specified.
   *
   * @see {@link https://hono.dev/docs/api/routing#base-path}
   *
   * @param {string} path - base Path
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * const api = new Hono().basePath('/api')
   * ```
   */
  basePath(path) {
    const subApp = this.#clone();
    subApp._basePath = mergePath(this._basePath, path);
    return subApp;
  }
  /**
   * `.onError()` handles an error and returns a customized Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#error-handling}
   *
   * @param {ErrorHandler} handler - request Handler for error
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.onError((err, c) => {
   *   console.error(`${err}`)
   *   return c.text('Custom Error Message', 500)
   * })
   * ```
   */
  onError = /* @__PURE__ */ __name((handler) => {
    this.errorHandler = handler;
    return this;
  }, "onError");
  /**
   * `.notFound()` allows you to customize a Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#not-found}
   *
   * @param {NotFoundHandler} handler - request handler for not-found
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.notFound((c) => {
   *   return c.text('Custom 404 Message', 404)
   * })
   * ```
   */
  notFound = /* @__PURE__ */ __name((handler) => {
    this.#notFoundHandler = handler;
    return this;
  }, "notFound");
  /**
   * `.mount()` allows you to mount applications built with other frameworks into your Hono application.
   *
   * @see {@link https://hono.dev/docs/api/hono#mount}
   *
   * @param {string} path - base Path
   * @param {Function} applicationHandler - other Request Handler
   * @param {MountOptions} [options] - options of `.mount()`
   * @returns {Hono} mounted Hono instance
   *
   * @example
   * ```ts
   * import { Router as IttyRouter } from 'itty-router'
   * import { Hono } from 'hono'
   * // Create itty-router application
   * const ittyRouter = IttyRouter()
   * // GET /itty-router/hello
   * ittyRouter.get('/hello', () => new Response('Hello from itty-router'))
   *
   * const app = new Hono()
   * app.mount('/itty-router', ittyRouter.handle)
   * ```
   *
   * @example
   * ```ts
   * const app = new Hono()
   * // Send the request to another application without modification.
   * app.mount('/app', anotherApp, {
   *   replaceRequest: (req) => req,
   * })
   * ```
   */
  mount(path, applicationHandler, options) {
    let replaceRequest;
    let optionHandler;
    if (options) {
      if (typeof options === "function") {
        optionHandler = options;
      } else {
        optionHandler = options.optionHandler;
        if (options.replaceRequest === false) {
          replaceRequest = /* @__PURE__ */ __name((request) => request, "replaceRequest");
        } else {
          replaceRequest = options.replaceRequest;
        }
      }
    }
    const getOptions = optionHandler ? (c) => {
      const options2 = optionHandler(c);
      return Array.isArray(options2) ? options2 : [options2];
    } : (c) => {
      let executionContext = void 0;
      try {
        executionContext = c.executionCtx;
      } catch {
      }
      return [c.env, executionContext];
    };
    replaceRequest ||= (() => {
      const mergedPath = mergePath(this._basePath, path);
      const pathPrefixLength = mergedPath === "/" ? 0 : mergedPath.length;
      return (request) => {
        const url = new URL(request.url);
        url.pathname = url.pathname.slice(pathPrefixLength) || "/";
        return new Request(url, request);
      };
    })();
    const handler = /* @__PURE__ */ __name(async (c, next) => {
      const res = await applicationHandler(replaceRequest(c.req.raw), ...getOptions(c));
      if (res) {
        return res;
      }
      await next();
    }, "handler");
    this.#addRoute(METHOD_NAME_ALL, mergePath(path, "*"), handler);
    return this;
  }
  #addRoute(method, path, handler) {
    method = method.toUpperCase();
    path = mergePath(this._basePath, path);
    const r = { basePath: this._basePath, path, method, handler };
    this.router.add(method, path, [handler, r]);
    this.routes.push(r);
  }
  #handleError(err, c) {
    if (err instanceof Error) {
      return this.errorHandler(err, c);
    }
    throw err;
  }
  #dispatch(request, executionCtx, env, method) {
    if (method === "HEAD") {
      return (async () => new Response(null, await this.#dispatch(request, executionCtx, env, "GET")))();
    }
    const path = this.getPath(request, { env });
    const matchResult = this.router.match(method, path);
    const c = new Context(request, {
      path,
      matchResult,
      env,
      executionCtx,
      notFoundHandler: this.#notFoundHandler
    });
    if (matchResult[0].length === 1) {
      let res;
      try {
        res = matchResult[0][0][0][0](c, async () => {
          c.res = await this.#notFoundHandler(c);
        });
      } catch (err) {
        return this.#handleError(err, c);
      }
      return res instanceof Promise ? res.then(
        (resolved) => resolved || (c.finalized ? c.res : this.#notFoundHandler(c))
      ).catch((err) => this.#handleError(err, c)) : res ?? this.#notFoundHandler(c);
    }
    const composed = compose(matchResult[0], this.errorHandler, this.#notFoundHandler);
    return (async () => {
      try {
        const context = await composed(c);
        if (!context.finalized) {
          throw new Error(
            "Context is not finalized. Did you forget to return a Response object or `await next()`?"
          );
        }
        return context.res;
      } catch (err) {
        return this.#handleError(err, c);
      }
    })();
  }
  /**
   * `.fetch()` will be entry point of your app.
   *
   * @see {@link https://hono.dev/docs/api/hono#fetch}
   *
   * @param {Request} request - request Object of request
   * @param {Env} Env - env Object
   * @param {ExecutionContext} - context of execution
   * @returns {Response | Promise<Response>} response of request
   *
   */
  fetch = /* @__PURE__ */ __name((request, ...rest) => {
    return this.#dispatch(request, rest[1], rest[0], request.method);
  }, "fetch");
  /**
   * `.request()` is a useful method for testing.
   * You can pass a URL or pathname to send a GET request.
   * app will return a Response object.
   * ```ts
   * test('GET /hello is ok', async () => {
   *   const res = await app.request('/hello')
   *   expect(res.status).toBe(200)
   * })
   * ```
   * @see https://hono.dev/docs/api/hono#request
   */
  request = /* @__PURE__ */ __name((input, requestInit, Env, executionCtx) => {
    if (input instanceof Request) {
      return this.fetch(requestInit ? new Request(input, requestInit) : input, Env, executionCtx);
    }
    input = input.toString();
    return this.fetch(
      new Request(
        /^https?:\/\//.test(input) ? input : `http://localhost${mergePath("/", input)}`,
        requestInit
      ),
      Env,
      executionCtx
    );
  }, "request");
  /**
   * `.fire()` automatically adds a global fetch event listener.
   * This can be useful for environments that adhere to the Service Worker API, such as non-ES module Cloudflare Workers.
   * @deprecated
   * Use `fire` from `hono/service-worker` instead.
   * ```ts
   * import { Hono } from 'hono'
   * import { fire } from 'hono/service-worker'
   *
   * const app = new Hono()
   * // ...
   * fire(app)
   * ```
   * @see https://hono.dev/docs/api/hono#fire
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
   * @see https://developers.cloudflare.com/workers/reference/migrate-to-module-workers/
   */
  fire = /* @__PURE__ */ __name(() => {
    addEventListener("fetch", (event) => {
      event.respondWith(this.#dispatch(event.request, event, void 0, event.request.method));
    });
  }, "fire");
};

// ../../node_modules/hono/dist/router/reg-exp-router/matcher.js
var emptyParam = [];
function match(method, path) {
  const matchers = this.buildAllMatchers();
  const match2 = /* @__PURE__ */ __name(((method2, path2) => {
    const matcher = matchers[method2] || matchers[METHOD_NAME_ALL];
    const staticMatch = matcher[2][path2];
    if (staticMatch) {
      return staticMatch;
    }
    const match3 = path2.match(matcher[0]);
    if (!match3) {
      return [[], emptyParam];
    }
    const index = match3.indexOf("", 1);
    return [matcher[1][index], match3];
  }), "match2");
  this.match = match2;
  return match2(method, path);
}
__name(match, "match");

// ../../node_modules/hono/dist/router/reg-exp-router/node.js
var LABEL_REG_EXP_STR = "[^/]+";
var ONLY_WILDCARD_REG_EXP_STR = ".*";
var TAIL_WILDCARD_REG_EXP_STR = "(?:|/.*)";
var PATH_ERROR = /* @__PURE__ */ Symbol();
var regExpMetaChars = new Set(".\\+*[^]$()");
function compareKey(a, b) {
  if (a.length === 1) {
    return b.length === 1 ? a < b ? -1 : 1 : -1;
  }
  if (b.length === 1) {
    return 1;
  }
  if (a === ONLY_WILDCARD_REG_EXP_STR || a === TAIL_WILDCARD_REG_EXP_STR) {
    return 1;
  } else if (b === ONLY_WILDCARD_REG_EXP_STR || b === TAIL_WILDCARD_REG_EXP_STR) {
    return -1;
  }
  if (a === LABEL_REG_EXP_STR) {
    return 1;
  } else if (b === LABEL_REG_EXP_STR) {
    return -1;
  }
  return a.length === b.length ? a < b ? -1 : 1 : b.length - a.length;
}
__name(compareKey, "compareKey");
var Node = class _Node {
  static {
    __name(this, "_Node");
  }
  #index;
  #varIndex;
  #children = /* @__PURE__ */ Object.create(null);
  insert(tokens, index, paramMap, context, pathErrorCheckOnly) {
    if (tokens.length === 0) {
      if (this.#index !== void 0) {
        throw PATH_ERROR;
      }
      if (pathErrorCheckOnly) {
        return;
      }
      this.#index = index;
      return;
    }
    const [token, ...restTokens] = tokens;
    const pattern = token === "*" ? restTokens.length === 0 ? ["", "", ONLY_WILDCARD_REG_EXP_STR] : ["", "", LABEL_REG_EXP_STR] : token === "/*" ? ["", "", TAIL_WILDCARD_REG_EXP_STR] : token.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
    let node;
    if (pattern) {
      const name = pattern[1];
      let regexpStr = pattern[2] || LABEL_REG_EXP_STR;
      if (name && pattern[2]) {
        if (regexpStr === ".*") {
          throw PATH_ERROR;
        }
        regexpStr = regexpStr.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:");
        if (/\((?!\?:)/.test(regexpStr)) {
          throw PATH_ERROR;
        }
      }
      node = this.#children[regexpStr];
      if (!node) {
        if (Object.keys(this.#children).some(
          (k) => k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
        )) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[regexpStr] = new _Node();
        if (name !== "") {
          node.#varIndex = context.varIndex++;
        }
      }
      if (!pathErrorCheckOnly && name !== "") {
        paramMap.push([name, node.#varIndex]);
      }
    } else {
      node = this.#children[token];
      if (!node) {
        if (Object.keys(this.#children).some(
          (k) => k.length > 1 && k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
        )) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[token] = new _Node();
      }
    }
    node.insert(restTokens, index, paramMap, context, pathErrorCheckOnly);
  }
  buildRegExpStr() {
    const childKeys = Object.keys(this.#children).sort(compareKey);
    const strList = childKeys.map((k) => {
      const c = this.#children[k];
      return (typeof c.#varIndex === "number" ? `(${k})@${c.#varIndex}` : regExpMetaChars.has(k) ? `\\${k}` : k) + c.buildRegExpStr();
    });
    if (typeof this.#index === "number") {
      strList.unshift(`#${this.#index}`);
    }
    if (strList.length === 0) {
      return "";
    }
    if (strList.length === 1) {
      return strList[0];
    }
    return "(?:" + strList.join("|") + ")";
  }
};

// ../../node_modules/hono/dist/router/reg-exp-router/trie.js
var Trie = class {
  static {
    __name(this, "Trie");
  }
  #context = { varIndex: 0 };
  #root = new Node();
  insert(path, index, pathErrorCheckOnly) {
    const paramAssoc = [];
    const groups = [];
    for (let i = 0; ; ) {
      let replaced = false;
      path = path.replace(/\{[^}]+\}/g, (m) => {
        const mark = `@\\${i}`;
        groups[i] = [mark, m];
        i++;
        replaced = true;
        return mark;
      });
      if (!replaced) {
        break;
      }
    }
    const tokens = path.match(/(?::[^\/]+)|(?:\/\*$)|./g) || [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const [mark] = groups[i];
      for (let j = tokens.length - 1; j >= 0; j--) {
        if (tokens[j].indexOf(mark) !== -1) {
          tokens[j] = tokens[j].replace(mark, groups[i][1]);
          break;
        }
      }
    }
    this.#root.insert(tokens, index, paramAssoc, this.#context, pathErrorCheckOnly);
    return paramAssoc;
  }
  buildRegExp() {
    let regexp = this.#root.buildRegExpStr();
    if (regexp === "") {
      return [/^$/, [], []];
    }
    let captureIndex = 0;
    const indexReplacementMap = [];
    const paramReplacementMap = [];
    regexp = regexp.replace(/#(\d+)|@(\d+)|\.\*\$/g, (_, handlerIndex, paramIndex) => {
      if (handlerIndex !== void 0) {
        indexReplacementMap[++captureIndex] = Number(handlerIndex);
        return "$()";
      }
      if (paramIndex !== void 0) {
        paramReplacementMap[Number(paramIndex)] = ++captureIndex;
        return "";
      }
      return "";
    });
    return [new RegExp(`^${regexp}`), indexReplacementMap, paramReplacementMap];
  }
};

// ../../node_modules/hono/dist/router/reg-exp-router/router.js
var nullMatcher = [/^$/, [], /* @__PURE__ */ Object.create(null)];
var wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
function buildWildcardRegExp(path) {
  return wildcardRegExpCache[path] ??= new RegExp(
    path === "*" ? "" : `^${path.replace(
      /\/\*$|([.\\+*[^\]$()])/g,
      (_, metaChar) => metaChar ? `\\${metaChar}` : "(?:|/.*)"
    )}$`
  );
}
__name(buildWildcardRegExp, "buildWildcardRegExp");
function clearWildcardRegExpCache() {
  wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
}
__name(clearWildcardRegExpCache, "clearWildcardRegExpCache");
function buildMatcherFromPreprocessedRoutes(routes) {
  const trie = new Trie();
  const handlerData = [];
  if (routes.length === 0) {
    return nullMatcher;
  }
  const routesWithStaticPathFlag = routes.map(
    (route) => [!/\*|\/:/.test(route[0]), ...route]
  ).sort(
    ([isStaticA, pathA], [isStaticB, pathB]) => isStaticA ? 1 : isStaticB ? -1 : pathA.length - pathB.length
  );
  const staticMap = /* @__PURE__ */ Object.create(null);
  for (let i = 0, j = -1, len = routesWithStaticPathFlag.length; i < len; i++) {
    const [pathErrorCheckOnly, path, handlers] = routesWithStaticPathFlag[i];
    if (pathErrorCheckOnly) {
      staticMap[path] = [handlers.map(([h]) => [h, /* @__PURE__ */ Object.create(null)]), emptyParam];
    } else {
      j++;
    }
    let paramAssoc;
    try {
      paramAssoc = trie.insert(path, j, pathErrorCheckOnly);
    } catch (e) {
      throw e === PATH_ERROR ? new UnsupportedPathError(path) : e;
    }
    if (pathErrorCheckOnly) {
      continue;
    }
    handlerData[j] = handlers.map(([h, paramCount]) => {
      const paramIndexMap = /* @__PURE__ */ Object.create(null);
      paramCount -= 1;
      for (; paramCount >= 0; paramCount--) {
        const [key, value] = paramAssoc[paramCount];
        paramIndexMap[key] = value;
      }
      return [h, paramIndexMap];
    });
  }
  const [regexp, indexReplacementMap, paramReplacementMap] = trie.buildRegExp();
  for (let i = 0, len = handlerData.length; i < len; i++) {
    for (let j = 0, len2 = handlerData[i].length; j < len2; j++) {
      const map = handlerData[i][j]?.[1];
      if (!map) {
        continue;
      }
      const keys = Object.keys(map);
      for (let k = 0, len3 = keys.length; k < len3; k++) {
        map[keys[k]] = paramReplacementMap[map[keys[k]]];
      }
    }
  }
  const handlerMap = [];
  for (const i in indexReplacementMap) {
    handlerMap[i] = handlerData[indexReplacementMap[i]];
  }
  return [regexp, handlerMap, staticMap];
}
__name(buildMatcherFromPreprocessedRoutes, "buildMatcherFromPreprocessedRoutes");
function findMiddleware(middleware, path) {
  if (!middleware) {
    return void 0;
  }
  for (const k of Object.keys(middleware).sort((a, b) => b.length - a.length)) {
    if (buildWildcardRegExp(k).test(path)) {
      return [...middleware[k]];
    }
  }
  return void 0;
}
__name(findMiddleware, "findMiddleware");
var RegExpRouter = class {
  static {
    __name(this, "RegExpRouter");
  }
  name = "RegExpRouter";
  #middleware;
  #routes;
  constructor() {
    this.#middleware = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
    this.#routes = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
  }
  add(method, path, handler) {
    const middleware = this.#middleware;
    const routes = this.#routes;
    if (!middleware || !routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    if (!middleware[method]) {
      ;
      [middleware, routes].forEach((handlerMap) => {
        handlerMap[method] = /* @__PURE__ */ Object.create(null);
        Object.keys(handlerMap[METHOD_NAME_ALL]).forEach((p) => {
          handlerMap[method][p] = [...handlerMap[METHOD_NAME_ALL][p]];
        });
      });
    }
    if (path === "/*") {
      path = "*";
    }
    const paramCount = (path.match(/\/:/g) || []).length;
    if (/\*$/.test(path)) {
      const re = buildWildcardRegExp(path);
      if (method === METHOD_NAME_ALL) {
        Object.keys(middleware).forEach((m) => {
          middleware[m][path] ||= findMiddleware(middleware[m], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
        });
      } else {
        middleware[method][path] ||= findMiddleware(middleware[method], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
      }
      Object.keys(middleware).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(middleware[m]).forEach((p) => {
            re.test(p) && middleware[m][p].push([handler, paramCount]);
          });
        }
      });
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(routes[m]).forEach(
            (p) => re.test(p) && routes[m][p].push([handler, paramCount])
          );
        }
      });
      return;
    }
    const paths = checkOptionalParameter(path) || [path];
    for (let i = 0, len = paths.length; i < len; i++) {
      const path2 = paths[i];
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          routes[m][path2] ||= [
            ...findMiddleware(middleware[m], path2) || findMiddleware(middleware[METHOD_NAME_ALL], path2) || []
          ];
          routes[m][path2].push([handler, paramCount - len + i + 1]);
        }
      });
    }
  }
  match = match;
  buildAllMatchers() {
    const matchers = /* @__PURE__ */ Object.create(null);
    Object.keys(this.#routes).concat(Object.keys(this.#middleware)).forEach((method) => {
      matchers[method] ||= this.#buildMatcher(method);
    });
    this.#middleware = this.#routes = void 0;
    clearWildcardRegExpCache();
    return matchers;
  }
  #buildMatcher(method) {
    const routes = [];
    let hasOwnRoute = method === METHOD_NAME_ALL;
    [this.#middleware, this.#routes].forEach((r) => {
      const ownRoute = r[method] ? Object.keys(r[method]).map((path) => [path, r[method][path]]) : [];
      if (ownRoute.length !== 0) {
        hasOwnRoute ||= true;
        routes.push(...ownRoute);
      } else if (method !== METHOD_NAME_ALL) {
        routes.push(
          ...Object.keys(r[METHOD_NAME_ALL]).map((path) => [path, r[METHOD_NAME_ALL][path]])
        );
      }
    });
    if (!hasOwnRoute) {
      return null;
    } else {
      return buildMatcherFromPreprocessedRoutes(routes);
    }
  }
};

// ../../node_modules/hono/dist/router/smart-router/router.js
var SmartRouter = class {
  static {
    __name(this, "SmartRouter");
  }
  name = "SmartRouter";
  #routers = [];
  #routes = [];
  constructor(init) {
    this.#routers = init.routers;
  }
  add(method, path, handler) {
    if (!this.#routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    this.#routes.push([method, path, handler]);
  }
  match(method, path) {
    if (!this.#routes) {
      throw new Error("Fatal error");
    }
    const routers = this.#routers;
    const routes = this.#routes;
    const len = routers.length;
    let i = 0;
    let res;
    for (; i < len; i++) {
      const router = routers[i];
      try {
        for (let i2 = 0, len2 = routes.length; i2 < len2; i2++) {
          router.add(...routes[i2]);
        }
        res = router.match(method, path);
      } catch (e) {
        if (e instanceof UnsupportedPathError) {
          continue;
        }
        throw e;
      }
      this.match = router.match.bind(router);
      this.#routers = [router];
      this.#routes = void 0;
      break;
    }
    if (i === len) {
      throw new Error("Fatal error");
    }
    this.name = `SmartRouter + ${this.activeRouter.name}`;
    return res;
  }
  get activeRouter() {
    if (this.#routes || this.#routers.length !== 1) {
      throw new Error("No active router has been determined yet.");
    }
    return this.#routers[0];
  }
};

// ../../node_modules/hono/dist/router/trie-router/node.js
var emptyParams = /* @__PURE__ */ Object.create(null);
var hasChildren = /* @__PURE__ */ __name((children) => {
  for (const _ in children) {
    return true;
  }
  return false;
}, "hasChildren");
var Node2 = class _Node2 {
  static {
    __name(this, "_Node");
  }
  #methods;
  #children;
  #patterns;
  #order = 0;
  #params = emptyParams;
  constructor(method, handler, children) {
    this.#children = children || /* @__PURE__ */ Object.create(null);
    this.#methods = [];
    if (method && handler) {
      const m = /* @__PURE__ */ Object.create(null);
      m[method] = { handler, possibleKeys: [], score: 0 };
      this.#methods = [m];
    }
    this.#patterns = [];
  }
  insert(method, path, handler) {
    this.#order = ++this.#order;
    let curNode = this;
    const parts = splitRoutingPath(path);
    const possibleKeys = [];
    for (let i = 0, len = parts.length; i < len; i++) {
      const p = parts[i];
      const nextP = parts[i + 1];
      const pattern = getPattern(p, nextP);
      const key = Array.isArray(pattern) ? pattern[0] : p;
      if (key in curNode.#children) {
        curNode = curNode.#children[key];
        if (pattern) {
          possibleKeys.push(pattern[1]);
        }
        continue;
      }
      curNode.#children[key] = new _Node2();
      if (pattern) {
        curNode.#patterns.push(pattern);
        possibleKeys.push(pattern[1]);
      }
      curNode = curNode.#children[key];
    }
    curNode.#methods.push({
      [method]: {
        handler,
        possibleKeys: possibleKeys.filter((v, i, a) => a.indexOf(v) === i),
        score: this.#order
      }
    });
    return curNode;
  }
  #pushHandlerSets(handlerSets, node, method, nodeParams, params) {
    for (let i = 0, len = node.#methods.length; i < len; i++) {
      const m = node.#methods[i];
      const handlerSet = m[method] || m[METHOD_NAME_ALL];
      const processedSet = {};
      if (handlerSet !== void 0) {
        handlerSet.params = /* @__PURE__ */ Object.create(null);
        handlerSets.push(handlerSet);
        if (nodeParams !== emptyParams || params && params !== emptyParams) {
          for (let i2 = 0, len2 = handlerSet.possibleKeys.length; i2 < len2; i2++) {
            const key = handlerSet.possibleKeys[i2];
            const processed = processedSet[handlerSet.score];
            handlerSet.params[key] = params?.[key] && !processed ? params[key] : nodeParams[key] ?? params?.[key];
            processedSet[handlerSet.score] = true;
          }
        }
      }
    }
  }
  search(method, path) {
    const handlerSets = [];
    this.#params = emptyParams;
    const curNode = this;
    let curNodes = [curNode];
    const parts = splitPath(path);
    const curNodesQueue = [];
    const len = parts.length;
    let partOffsets = null;
    for (let i = 0; i < len; i++) {
      const part = parts[i];
      const isLast = i === len - 1;
      const tempNodes = [];
      for (let j = 0, len2 = curNodes.length; j < len2; j++) {
        const node = curNodes[j];
        const nextNode = node.#children[part];
        if (nextNode) {
          nextNode.#params = node.#params;
          if (isLast) {
            if (nextNode.#children["*"]) {
              this.#pushHandlerSets(handlerSets, nextNode.#children["*"], method, node.#params);
            }
            this.#pushHandlerSets(handlerSets, nextNode, method, node.#params);
          } else {
            tempNodes.push(nextNode);
          }
        }
        for (let k = 0, len3 = node.#patterns.length; k < len3; k++) {
          const pattern = node.#patterns[k];
          const params = node.#params === emptyParams ? {} : { ...node.#params };
          if (pattern === "*") {
            const astNode = node.#children["*"];
            if (astNode) {
              this.#pushHandlerSets(handlerSets, astNode, method, node.#params);
              astNode.#params = params;
              tempNodes.push(astNode);
            }
            continue;
          }
          const [key, name, matcher] = pattern;
          if (!part && !(matcher instanceof RegExp)) {
            continue;
          }
          const child = node.#children[key];
          if (matcher instanceof RegExp) {
            if (partOffsets === null) {
              partOffsets = new Array(len);
              let offset = path[0] === "/" ? 1 : 0;
              for (let p = 0; p < len; p++) {
                partOffsets[p] = offset;
                offset += parts[p].length + 1;
              }
            }
            const restPathString = path.substring(partOffsets[i]);
            const m = matcher.exec(restPathString);
            if (m) {
              params[name] = m[0];
              this.#pushHandlerSets(handlerSets, child, method, node.#params, params);
              if (hasChildren(child.#children)) {
                child.#params = params;
                const componentCount = m[0].match(/\//)?.length ?? 0;
                const targetCurNodes = curNodesQueue[componentCount] ||= [];
                targetCurNodes.push(child);
              }
              continue;
            }
          }
          if (matcher === true || matcher.test(part)) {
            params[name] = part;
            if (isLast) {
              this.#pushHandlerSets(handlerSets, child, method, params, node.#params);
              if (child.#children["*"]) {
                this.#pushHandlerSets(
                  handlerSets,
                  child.#children["*"],
                  method,
                  params,
                  node.#params
                );
              }
            } else {
              child.#params = params;
              tempNodes.push(child);
            }
          }
        }
      }
      const shifted = curNodesQueue.shift();
      curNodes = shifted ? tempNodes.concat(shifted) : tempNodes;
    }
    if (handlerSets.length > 1) {
      handlerSets.sort((a, b) => {
        return a.score - b.score;
      });
    }
    return [handlerSets.map(({ handler, params }) => [handler, params])];
  }
};

// ../../node_modules/hono/dist/router/trie-router/router.js
var TrieRouter = class {
  static {
    __name(this, "TrieRouter");
  }
  name = "TrieRouter";
  #node;
  constructor() {
    this.#node = new Node2();
  }
  add(method, path, handler) {
    const results = checkOptionalParameter(path);
    if (results) {
      for (let i = 0, len = results.length; i < len; i++) {
        this.#node.insert(method, results[i], handler);
      }
      return;
    }
    this.#node.insert(method, path, handler);
  }
  match(method, path) {
    return this.#node.search(method, path);
  }
};

// ../../node_modules/hono/dist/hono.js
var Hono2 = class extends Hono {
  static {
    __name(this, "Hono");
  }
  /**
   * Creates an instance of the Hono class.
   *
   * @param options - Optional configuration options for the Hono instance.
   */
  constructor(options = {}) {
    super(options);
    this.router = options.router ?? new SmartRouter({
      routers: [new RegExpRouter(), new TrieRouter()]
    });
  }
};

// ../../node_modules/hono/dist/middleware/cors/index.js
var cors = /* @__PURE__ */ __name((options) => {
  const defaults = {
    origin: "*",
    allowMethods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"],
    allowHeaders: [],
    exposeHeaders: []
  };
  const opts = {
    ...defaults,
    ...options
  };
  const findAllowOrigin = ((optsOrigin) => {
    if (typeof optsOrigin === "string") {
      if (optsOrigin === "*") {
        return () => optsOrigin;
      } else {
        return (origin) => optsOrigin === origin ? origin : null;
      }
    } else if (typeof optsOrigin === "function") {
      return optsOrigin;
    } else {
      return (origin) => optsOrigin.includes(origin) ? origin : null;
    }
  })(opts.origin);
  const findAllowMethods = ((optsAllowMethods) => {
    if (typeof optsAllowMethods === "function") {
      return optsAllowMethods;
    } else if (Array.isArray(optsAllowMethods)) {
      return () => optsAllowMethods;
    } else {
      return () => [];
    }
  })(opts.allowMethods);
  return /* @__PURE__ */ __name(async function cors2(c, next) {
    function set(key, value) {
      c.res.headers.set(key, value);
    }
    __name(set, "set");
    const allowOrigin = await findAllowOrigin(c.req.header("origin") || "", c);
    if (allowOrigin) {
      set("Access-Control-Allow-Origin", allowOrigin);
    }
    if (opts.credentials) {
      set("Access-Control-Allow-Credentials", "true");
    }
    if (opts.exposeHeaders?.length) {
      set("Access-Control-Expose-Headers", opts.exposeHeaders.join(","));
    }
    if (c.req.method === "OPTIONS") {
      if (opts.origin !== "*") {
        set("Vary", "Origin");
      }
      if (opts.maxAge != null) {
        set("Access-Control-Max-Age", opts.maxAge.toString());
      }
      const allowMethods = await findAllowMethods(c.req.header("origin") || "", c);
      if (allowMethods.length) {
        set("Access-Control-Allow-Methods", allowMethods.join(","));
      }
      let headers = opts.allowHeaders;
      if (!headers?.length) {
        const requestHeaders = c.req.header("Access-Control-Request-Headers");
        if (requestHeaders) {
          headers = requestHeaders.split(/\s*,\s*/);
        }
      }
      if (headers?.length) {
        set("Access-Control-Allow-Headers", headers.join(","));
        c.res.headers.append("Vary", "Access-Control-Request-Headers");
      }
      c.res.headers.delete("Content-Length");
      c.res.headers.delete("Content-Type");
      return new Response(null, {
        headers: c.res.headers,
        status: 204,
        statusText: "No Content"
      });
    }
    await next();
    if (opts.origin !== "*") {
      c.header("Vary", "Origin", { append: true });
    }
  }, "cors2");
}, "cors");

// ../../node_modules/hono/dist/utils/color.js
function getColorEnabled() {
  const { process, Deno } = globalThis;
  const isNoColor = typeof Deno?.noColor === "boolean" ? Deno.noColor : process !== void 0 ? (
    // eslint-disable-next-line no-unsafe-optional-chaining
    "NO_COLOR" in process?.env
  ) : false;
  return !isNoColor;
}
__name(getColorEnabled, "getColorEnabled");
async function getColorEnabledAsync() {
  const { navigator: navigator2 } = globalThis;
  const cfWorkers = "cloudflare:workers";
  const isNoColor = navigator2 !== void 0 && navigator2.userAgent === "Cloudflare-Workers" ? await (async () => {
    try {
      return "NO_COLOR" in ((await import(cfWorkers)).env ?? {});
    } catch {
      return false;
    }
  })() : !getColorEnabled();
  return !isNoColor;
}
__name(getColorEnabledAsync, "getColorEnabledAsync");

// ../../node_modules/hono/dist/middleware/logger/index.js
var humanize = /* @__PURE__ */ __name((times) => {
  const [delimiter, separator] = [",", "."];
  const orderTimes = times.map((v) => v.replace(/(\d)(?=(\d\d\d)+(?!\d))/g, "$1" + delimiter));
  return orderTimes.join(separator);
}, "humanize");
var time = /* @__PURE__ */ __name((start) => {
  const delta = Date.now() - start;
  return humanize([delta < 1e3 ? delta + "ms" : Math.round(delta / 1e3) + "s"]);
}, "time");
var colorStatus = /* @__PURE__ */ __name(async (status) => {
  const colorEnabled = await getColorEnabledAsync();
  if (colorEnabled) {
    switch (status / 100 | 0) {
      case 5:
        return `\x1B[31m${status}\x1B[0m`;
      case 4:
        return `\x1B[33m${status}\x1B[0m`;
      case 3:
        return `\x1B[36m${status}\x1B[0m`;
      case 2:
        return `\x1B[32m${status}\x1B[0m`;
    }
  }
  return `${status}`;
}, "colorStatus");
async function log(fn, prefix, method, path, status = 0, elapsed) {
  const out = prefix === "<--" ? `${prefix} ${method} ${path}` : `${prefix} ${method} ${path} ${await colorStatus(status)} ${elapsed}`;
  fn(out);
}
__name(log, "log");
var logger = /* @__PURE__ */ __name((fn = console.log) => {
  return /* @__PURE__ */ __name(async function logger2(c, next) {
    const { method, url } = c.req;
    const path = url.slice(url.indexOf("/", 8));
    await log(fn, "<--", method, path);
    const start = Date.now();
    await next();
    await log(fn, "-->", method, path, c.res.status, time(start));
  }, "logger2");
}, "logger");

// ../../node_modules/hono/dist/middleware/secure-headers/secure-headers.js
var HEADERS_MAP = {
  crossOriginEmbedderPolicy: ["Cross-Origin-Embedder-Policy", "require-corp"],
  crossOriginResourcePolicy: ["Cross-Origin-Resource-Policy", "same-origin"],
  crossOriginOpenerPolicy: ["Cross-Origin-Opener-Policy", "same-origin"],
  originAgentCluster: ["Origin-Agent-Cluster", "?1"],
  referrerPolicy: ["Referrer-Policy", "no-referrer"],
  strictTransportSecurity: ["Strict-Transport-Security", "max-age=15552000; includeSubDomains"],
  xContentTypeOptions: ["X-Content-Type-Options", "nosniff"],
  xDnsPrefetchControl: ["X-DNS-Prefetch-Control", "off"],
  xDownloadOptions: ["X-Download-Options", "noopen"],
  xFrameOptions: ["X-Frame-Options", "SAMEORIGIN"],
  xPermittedCrossDomainPolicies: ["X-Permitted-Cross-Domain-Policies", "none"],
  xXssProtection: ["X-XSS-Protection", "0"]
};
var DEFAULT_OPTIONS = {
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: true,
  crossOriginOpenerPolicy: true,
  originAgentCluster: true,
  referrerPolicy: true,
  strictTransportSecurity: true,
  xContentTypeOptions: true,
  xDnsPrefetchControl: true,
  xDownloadOptions: true,
  xFrameOptions: true,
  xPermittedCrossDomainPolicies: true,
  xXssProtection: true,
  removePoweredBy: true,
  permissionsPolicy: {}
};
var secureHeaders = /* @__PURE__ */ __name((customOptions) => {
  const options = { ...DEFAULT_OPTIONS, ...customOptions };
  const headersToSet = getFilteredHeaders(options);
  const callbacks = [];
  if (options.contentSecurityPolicy) {
    const [callback, value] = getCSPDirectives(options.contentSecurityPolicy);
    if (callback) {
      callbacks.push(callback);
    }
    headersToSet.push(["Content-Security-Policy", value]);
  }
  if (options.contentSecurityPolicyReportOnly) {
    const [callback, value] = getCSPDirectives(options.contentSecurityPolicyReportOnly);
    if (callback) {
      callbacks.push(callback);
    }
    headersToSet.push(["Content-Security-Policy-Report-Only", value]);
  }
  if (options.permissionsPolicy && Object.keys(options.permissionsPolicy).length > 0) {
    headersToSet.push([
      "Permissions-Policy",
      getPermissionsPolicyDirectives(options.permissionsPolicy)
    ]);
  }
  if (options.reportingEndpoints) {
    headersToSet.push(["Reporting-Endpoints", getReportingEndpoints(options.reportingEndpoints)]);
  }
  if (options.reportTo) {
    headersToSet.push(["Report-To", getReportToOptions(options.reportTo)]);
  }
  return /* @__PURE__ */ __name(async function secureHeaders2(ctx, next) {
    const headersToSetForReq = callbacks.length === 0 ? headersToSet : callbacks.reduce((acc, cb) => cb(ctx, acc), headersToSet);
    await next();
    setHeaders(ctx, headersToSetForReq);
    if (options?.removePoweredBy) {
      ctx.res.headers.delete("X-Powered-By");
    }
  }, "secureHeaders2");
}, "secureHeaders");
function getFilteredHeaders(options) {
  return Object.entries(HEADERS_MAP).filter(([key]) => options[key]).map(([key, defaultValue]) => {
    const overrideValue = options[key];
    return typeof overrideValue === "string" ? [defaultValue[0], overrideValue] : defaultValue;
  });
}
__name(getFilteredHeaders, "getFilteredHeaders");
function getCSPDirectives(contentSecurityPolicy) {
  const callbacks = [];
  const resultValues = [];
  for (const [directive, value] of Object.entries(contentSecurityPolicy)) {
    const valueArray = Array.isArray(value) ? value : [value];
    valueArray.forEach((value2, i) => {
      if (typeof value2 === "function") {
        const index = i * 2 + 2 + resultValues.length;
        callbacks.push((ctx, values) => {
          values[index] = value2(ctx, directive);
        });
      }
    });
    resultValues.push(
      directive.replace(
        /[A-Z]+(?![a-z])|[A-Z]/g,
        (match2, offset) => offset ? "-" + match2.toLowerCase() : match2.toLowerCase()
      ),
      ...valueArray.flatMap((value2) => [" ", value2]),
      "; "
    );
  }
  resultValues.pop();
  return callbacks.length === 0 ? [void 0, resultValues.join("")] : [
    (ctx, headersToSet) => headersToSet.map((values) => {
      if (values[0] === "Content-Security-Policy" || values[0] === "Content-Security-Policy-Report-Only") {
        const clone2 = values[1].slice();
        callbacks.forEach((cb) => {
          cb(ctx, clone2);
        });
        return [values[0], clone2.join("")];
      } else {
        return values;
      }
    }),
    resultValues
  ];
}
__name(getCSPDirectives, "getCSPDirectives");
function getPermissionsPolicyDirectives(policy) {
  return Object.entries(policy).map(([directive, value]) => {
    const kebabDirective = camelToKebab(directive);
    if (typeof value === "boolean") {
      return `${kebabDirective}=${value ? "*" : "none"}`;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return `${kebabDirective}=()`;
      }
      if (value.length === 1 && (value[0] === "*" || value[0] === "none")) {
        return `${kebabDirective}=${value[0]}`;
      }
      const allowlist = value.map((item) => ["self", "src"].includes(item) ? item : `"${item}"`);
      return `${kebabDirective}=(${allowlist.join(" ")})`;
    }
    return "";
  }).filter(Boolean).join(", ");
}
__name(getPermissionsPolicyDirectives, "getPermissionsPolicyDirectives");
function camelToKebab(str) {
  return str.replace(/([a-z\d])([A-Z])/g, "$1-$2").toLowerCase();
}
__name(camelToKebab, "camelToKebab");
function getReportingEndpoints(reportingEndpoints = []) {
  return reportingEndpoints.map((endpoint) => `${endpoint.name}="${endpoint.url}"`).join(", ");
}
__name(getReportingEndpoints, "getReportingEndpoints");
function getReportToOptions(reportTo = []) {
  return reportTo.map((option) => JSON.stringify(option)).join(", ");
}
__name(getReportToOptions, "getReportToOptions");
function setHeaders(ctx, headersToSet) {
  headersToSet.forEach(([header, value]) => {
    ctx.res.headers.set(header, value);
  });
}
__name(setHeaders, "setHeaders");

// config/lenders.json
var lenders_default = {
  version: 2,
  generated_at: "2026-02-23T00:00:00Z",
  lenders: [
    {
      code: "cba",
      name: "CBA",
      canonical_bank_name: "Commonwealth Bank of Australia",
      register_brand_name: "Commonwealth Bank of Australia",
      products_endpoint: "https://api.commbank.com.au/public/cds-au/v1/banking/products",
      seed_rate_urls: [
        "https://www.commbank.com.au/home-loans/rates-and-fees.html"
      ]
    },
    {
      code: "westpac",
      name: "Westpac",
      canonical_bank_name: "Westpac Banking Corporation",
      register_brand_name: "Westpac",
      products_endpoint: "https://digital-api.westpac.com.au/cds-au/v1/banking/products",
      seed_rate_urls: [
        "https://www.westpac.com.au/personal-banking/home-loans/interest-rates/"
      ]
    },
    {
      code: "nab",
      name: "NAB",
      canonical_bank_name: "National Australia Bank",
      register_brand_name: "NAB",
      products_endpoint: "https://openbank.api.nab.com.au/cds-au/v1/banking/products",
      seed_rate_urls: [
        "https://www.nab.com.au/personal/home-loans/interest-rates"
      ]
    },
    {
      code: "anz",
      name: "ANZ",
      canonical_bank_name: "ANZ",
      register_brand_name: "ANZ",
      products_endpoint: "https://api.anz/cds-au/v1/banking/products",
      seed_rate_urls: [
        "https://www.anz.com.au/personal/home-loans/interest-rates/"
      ]
    },
    {
      code: "macquarie",
      name: "Macquarie",
      canonical_bank_name: "Macquarie Bank",
      register_brand_name: "Macquarie Bank",
      products_endpoint: "https://api.macquariebank.io/cds-au/v1/banking/products",
      seed_rate_urls: [
        "https://www.macquarie.com.au/home-loans/interest-rates.html"
      ]
    },
    {
      code: "bendigo_adelaide",
      name: "Bendigo & Adelaide",
      canonical_bank_name: "Bendigo and Adelaide Bank",
      register_brand_name: "Bendigo and Adelaide Bank",
      products_endpoint: "https://api.cdr.bendigobank.com.au/cds-au/v1/banking/products",
      seed_rate_urls: [
        "https://www.bendigobank.com.au/personal/home-loans/interest-rates/"
      ]
    },
    {
      code: "suncorp",
      name: "Suncorp",
      canonical_bank_name: "Suncorp Bank",
      register_brand_name: "Suncorp Bank",
      products_endpoint: "https://id-ob.suncorpbank.com.au/cds-au/v1/banking/products",
      seed_rate_urls: [
        "https://www.suncorpbank.com.au/home-loans/rates"
      ]
    },
    {
      code: "bankwest",
      name: "Bankwest",
      canonical_bank_name: "Bankwest",
      register_brand_name: "Bankwest",
      products_endpoint: "https://open-api.bankwest.com.au/bwpublic/cds-au/v1/banking/products",
      seed_rate_urls: [
        "https://www.bankwest.com.au/personal/home-buying/home-loan-rates"
      ]
    },
    {
      code: "ing",
      name: "ING",
      canonical_bank_name: "ING",
      register_brand_name: "ING",
      products_endpoint: "https://id.ob.ing.com.au/cds-au/v1/banking/products",
      seed_rate_urls: [
        "https://www.ing.com.au/home-loans/rates-and-fees.html"
      ]
    },
    {
      code: "amp",
      name: "AMP",
      canonical_bank_name: "AMP Bank",
      register_brand_name: "AMP Bank",
      products_endpoint: "https://pub.cdr-sme.amp.com.au/api/cds-au/v1/banking/products",
      seed_rate_urls: [
        "https://www.amp.com.au/home-loans/rates-and-fees"
      ]
    },
    {
      code: "hsbc",
      name: "HSBC",
      canonical_bank_name: "HSBC Australia",
      register_brand_name: "HSBC Bank Australia Limited",
      products_endpoint: "https://public.ob.hsbc.com.au/cds-au/v1/banking/products",
      seed_rate_urls: [
        "https://www.hsbc.com.au/home-loans/products/rates/"
      ]
    },
    {
      code: "ubank",
      name: "UBank",
      canonical_bank_name: "UBank",
      register_brand_name: "ubank",
      products_endpoint: "https://public.cdr-api.86400.com.au/cds-au/v1/banking/products",
      seed_rate_urls: [
        "https://www.ubank.com.au/home-loans/interest-rates-and-fees"
      ]
    },
    {
      code: "stgeorge",
      name: "St. George",
      canonical_bank_name: "St. George Bank",
      register_brand_name: "St.George Bank",
      products_endpoint: "https://digital-api.stgeorge.com.au/cds-au/v1/banking/products",
      seed_rate_urls: [
        "https://www.stgeorge.com.au/personal/home-loans/our-home-loans/rates"
      ]
    },
    {
      code: "bankofmelbourne",
      name: "Bank of Melbourne",
      canonical_bank_name: "Bank of Melbourne",
      register_brand_name: "Bank of Melbourne",
      products_endpoint: "https://digital-api.bankofmelbourne.com.au/cds-au/v1/banking/products",
      seed_rate_urls: [
        "https://www.bankofmelbourne.com.au/personal/home-loans/our-home-loans/rates"
      ]
    },
    {
      code: "boq",
      name: "BOQ",
      canonical_bank_name: "Bank of Queensland",
      register_brand_name: "Bank of Queensland",
      seed_rate_urls: [
        "https://www.boq.com.au/personal/home-loans/home-loan-interest-rates"
      ]
    },
    {
      code: "great_southern",
      name: "Great Southern Bank",
      canonical_bank_name: "Great Southern Bank",
      register_brand_name: "Great Southern Bank",
      seed_rate_urls: [
        "https://www.greatsouthernbank.com.au/home-loans/rates"
      ]
    }
  ]
};

// src/constants.ts
var API_BASE_PATH = "/api/home-loan-rates";
var SAVINGS_API_BASE_PATH = "/api/savings-rates";
var TD_API_BASE_PATH = "/api/term-deposit-rates";
var MELBOURNE_TIMEZONE = "Australia/Melbourne";
var DEFAULT_PUBLIC_CACHE_SECONDS = 120;
var DEFAULT_LOCK_TTL_SECONDS = 7200;
var DEFAULT_MAX_QUEUE_ATTEMPTS = 6;
var SECURITY_PURPOSES = ["owner_occupied", "investment"];
var REPAYMENT_TYPES = ["principal_and_interest", "interest_only"];
var RATE_STRUCTURES = [
  "variable",
  "fixed_1yr",
  "fixed_2yr",
  "fixed_3yr",
  "fixed_4yr",
  "fixed_5yr"
];
var LVR_TIERS = ["lvr_=60%", "lvr_60-70%", "lvr_70-80%", "lvr_80-85%", "lvr_85-90%", "lvr_90-95%"];
var FEATURE_SETS = ["basic", "premium"];
var SAVINGS_ACCOUNT_TYPES = ["savings", "transaction", "at_call"];
var SAVINGS_RATE_TYPES = ["base", "bonus", "introductory", "bundle", "total"];
var INTEREST_PAYMENTS = ["at_maturity", "monthly", "quarterly", "annually"];
var lendersConfig = lenders_default;
var TARGET_LENDERS = lendersConfig.lenders;
var CDR_REGISTER_DISCOVERY_URL = "https://consumerdatastandardsaustralia.github.io/register/";

// src/utils/time.ts
function parseIntlParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const raw2 = formatter.formatToParts(date);
  const mapped = Object.fromEntries(raw2.map((part) => [part.type, part.value]));
  return {
    date: `${mapped.year}-${mapped.month}-${mapped.day}`,
    hour: Number(mapped.hour),
    minute: Number(mapped.minute),
    second: Number(mapped.second),
    timeZone,
    iso: date.toISOString()
  };
}
__name(parseIntlParts, "parseIntlParts");
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(nowIso, "nowIso");
function getMelbourneNowParts(date = /* @__PURE__ */ new Date(), timeZone = MELBOURNE_TIMEZONE) {
  return parseIntlParts(date, timeZone);
}
__name(getMelbourneNowParts, "getMelbourneNowParts");
function parseIntegerEnv(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
__name(parseIntegerEnv, "parseIntegerEnv");
function currentMonthCursor(parts) {
  return parts.date.slice(0, 7);
}
__name(currentMonthCursor, "currentMonthCursor");

// src/durable/run-lock.ts
var STORAGE_KEY = "lock-record";
var MIN_TTL_SECONDS = 30;
var MAX_TTL_SECONDS = 24 * 60 * 60;
function clampTtl(ttlSeconds) {
  const parsed = Number(ttlSeconds);
  if (!Number.isFinite(parsed)) {
    return 7200;
  }
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, Math.floor(parsed)));
}
__name(clampTtl, "clampTtl");
var RunLockDO = class {
  constructor(state) {
    this.state = state;
  }
  static {
    __name(this, "RunLockDO");
  }
  async fetch(request) {
    let payload = null;
    if (request.method === "POST") {
      payload = await request.json().catch(() => null);
    } else {
      const url = new URL(request.url);
      const action = String(url.searchParams.get("action") || "");
      const key = String(url.searchParams.get("key") || "");
      const owner = String(url.searchParams.get("owner") || "") || void 0;
      const ttlSeconds = Number(url.searchParams.get("ttlSeconds") || "") || void 0;
      payload = { action, key, owner, ttlSeconds };
    }
    if (!payload || !payload.action || !payload.key) {
      return Response.json(
        {
          ok: false,
          action: payload?.action || "status",
          key: payload?.key || "",
          locked: false,
          reason: "invalid_lock_request"
        },
        { status: 400 }
      );
    }
    if (payload.action === "acquire") {
      return this.handleAcquire(payload);
    }
    if (payload.action === "release") {
      return this.handleRelease(payload);
    }
    if (payload.action === "status") {
      return this.handleStatus(payload);
    }
    return Response.json(
      {
        ok: false,
        action: payload.action,
        key: payload.key,
        locked: false,
        reason: "unsupported_action"
      },
      { status: 400 }
    );
  }
  async readRecord() {
    const record = await this.state.storage.get(STORAGE_KEY);
    if (!record) {
      return null;
    }
    if (record.expiresAt <= Date.now()) {
      await this.state.storage.delete(STORAGE_KEY);
      return null;
    }
    return record;
  }
  async handleAcquire(payload) {
    const owner = String(payload.owner || "unknown");
    const ttlSeconds = clampTtl(payload.ttlSeconds);
    const now = Date.now();
    const existing = await this.readRecord();
    if (existing) {
      return Response.json({
        ok: true,
        action: "acquire",
        key: payload.key,
        locked: true,
        acquired: false,
        owner: existing.owner,
        acquiredAt: existing.acquiredAt,
        expiresAt: existing.expiresAt
      });
    }
    const record = {
      key: payload.key,
      owner,
      acquiredAt: nowIso(),
      expiresAt: now + ttlSeconds * 1e3
    };
    await this.state.storage.put(STORAGE_KEY, record);
    return Response.json({
      ok: true,
      action: "acquire",
      key: payload.key,
      locked: true,
      acquired: true,
      owner: record.owner,
      acquiredAt: record.acquiredAt,
      expiresAt: record.expiresAt
    });
  }
  async handleRelease(payload) {
    const existing = await this.readRecord();
    if (!existing) {
      return Response.json({
        ok: true,
        action: "release",
        key: payload.key,
        locked: false,
        released: false,
        reason: "lock_not_found"
      });
    }
    if (payload.owner && payload.owner !== existing.owner) {
      return Response.json({
        ok: false,
        action: "release",
        key: payload.key,
        locked: true,
        released: false,
        owner: existing.owner,
        reason: "owner_mismatch"
      }, { status: 409 });
    }
    await this.state.storage.delete(STORAGE_KEY);
    return Response.json({
      ok: true,
      action: "release",
      key: payload.key,
      locked: false,
      released: true
    });
  }
  async handleStatus(payload) {
    const existing = await this.readRecord();
    if (!existing) {
      return Response.json({
        ok: true,
        action: "status",
        key: payload.key,
        locked: false
      });
    }
    return Response.json({
      ok: true,
      action: "status",
      key: payload.key,
      locked: true,
      owner: existing.owner,
      acquiredAt: existing.acquiredAt,
      expiresAt: existing.expiresAt
    });
  }
};
async function callLock(env, key, payload) {
  const id = env.RUN_LOCK_DO.idFromName(key);
  const stub = env.RUN_LOCK_DO.get(id);
  const response = await stub.fetch("https://run-lock.internal", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ ...payload, key })
  });
  if (!response.ok) {
    return {
      ok: false,
      action: payload.action,
      key,
      locked: false,
      reason: `lock_request_failed_${response.status}`
    };
  }
  const data = await response.json();
  return data;
}
__name(callLock, "callLock");
async function acquireRunLock(env, params) {
  return callLock(env, params.key, {
    action: "acquire",
    owner: params.owner,
    ttlSeconds: params.ttlSeconds
  });
}
__name(acquireRunLock, "acquireRunLock");
async function releaseRunLock(env, params) {
  return callLock(env, params.key, {
    action: "release",
    owner: params.owner
  });
}
__name(releaseRunLock, "releaseRunLock");

// src/db/app-config.ts
var APP_CONFIG_TABLE = "app_config";
async function getAppConfig(db, key) {
  const row = await db.prepare(`SELECT value FROM ${APP_CONFIG_TABLE} WHERE key = ?`).bind(key).first();
  return row?.value ?? null;
}
__name(getAppConfig, "getAppConfig");
async function setAppConfig(db, key, value) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await db.prepare(
    `INSERT INTO ${APP_CONFIG_TABLE} (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(key, value, now).run();
}
__name(setAppConfig, "setAppConfig");

// src/ingest/normalize.ts
var MIN_RATE_PERCENT = 0.5;
var MAX_RATE_PERCENT = 25;
var MIN_COMPARISON_RATE_PERCENT = 0.5;
var MAX_COMPARISON_RATE_PERCENT = 30;
var MAX_ANNUAL_FEE = 1e4;
function asText(value) {
  if (value == null) {
    return "";
  }
  return String(value).trim();
}
__name(asText, "asText");
function lower(value) {
  return asText(value).toLowerCase();
}
__name(lower, "lower");
function parseSingleNumberToken(value) {
  if (value == null || value === "") {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const text = String(value);
  const matches = text.match(/-?\d+(?:\.\d+)?/g) ?? [];
  if (matches.length !== 1) {
    return null;
  }
  const n = Number(matches[0]);
  return Number.isFinite(n) ? n : null;
}
__name(parseSingleNumberToken, "parseSingleNumberToken");
function normalizePercentValue(value) {
  const n = parseSingleNumberToken(value);
  if (n == null) return null;
  const text = String(value ?? "");
  const hasPercent = text.includes("%");
  if (!hasPercent && n > 0 && n < 1) {
    return Number((n * 100).toFixed(4));
  }
  return n;
}
__name(normalizePercentValue, "normalizePercentValue");
function parseYears(text) {
  const m = text.match(/([1-5])\s*(?:year|yr)/i);
  if (!m) {
    return null;
  }
  const years = Number(m[1]);
  return Number.isFinite(years) ? years : null;
}
__name(parseYears, "parseYears");
function normalizeBankName(input, fallback) {
  const v = asText(input);
  return v || fallback;
}
__name(normalizeBankName, "normalizeBankName");
function normalizeProductName(input) {
  return asText(input).replace(/\s+/g, " ").trim();
}
__name(normalizeProductName, "normalizeProductName");
function normalizeSecurityPurpose(text) {
  const t = lower(text);
  if (t.includes("invest")) {
    return "investment";
  }
  return "owner_occupied";
}
__name(normalizeSecurityPurpose, "normalizeSecurityPurpose");
function normalizeRepaymentType(text) {
  const t = lower(text);
  if (t.includes("interest only") || t.includes("interest_only") || t.includes("interestonly") || /\binterest[_\s]*only[_\s]*(?:fixed|variable)?\b/.test(t)) {
    return "interest_only";
  }
  return "principal_and_interest";
}
__name(normalizeRepaymentType, "normalizeRepaymentType");
function normalizeRateStructure(input) {
  const t = lower(input);
  if (t.includes("variable")) {
    return "variable";
  }
  if (t.includes("fixed")) {
    const years = parseYears(t);
    if (years === 1) return "fixed_1yr";
    if (years === 2) return "fixed_2yr";
    if (years === 3) return "fixed_3yr";
    if (years === 4) return "fixed_4yr";
    if (years === 5) return "fixed_5yr";
    return "fixed_1yr";
  }
  return "variable";
}
__name(normalizeRateStructure, "normalizeRateStructure");
function tierForBoundary(percent) {
  if (percent <= 60) return "lvr_=60%";
  if (percent <= 70) return "lvr_60-70%";
  if (percent <= 80) return "lvr_70-80%";
  if (percent <= 85) return "lvr_80-85%";
  if (percent <= 90) return "lvr_85-90%";
  return "lvr_90-95%";
}
__name(tierForBoundary, "tierForBoundary");
function normalizeLvrTier(text, minLvr, maxLvr) {
  if (Number.isFinite(minLvr) || Number.isFinite(maxLvr)) {
    const hi = Number.isFinite(maxLvr) ? maxLvr : minLvr;
    return { tier: tierForBoundary(hi), wasDefault: false };
  }
  const t = lower(text);
  const range = t.match(/(\d{1,2}(?:\.\d+)?)\s*(?:-|to)\s*(\d{1,2}(?:\.\d+)?)\s*%/);
  if (range) {
    const hi = Number(range[2]);
    if (Number.isFinite(hi)) {
      return { tier: tierForBoundary(hi), wasDefault: false };
    }
  }
  const le = t.match(/(?:<=|≤|under|up to|maximum|max)\s*(\d{1,2}(?:\.\d+)?)\s*%/);
  if (le) {
    const hi = Number(le[1]);
    if (Number.isFinite(hi)) {
      return { tier: tierForBoundary(hi), wasDefault: false };
    }
  }
  const anyPercent = t.match(/(\d{1,2}(?:\.\d+)?)\s*%/);
  if (anyPercent) {
    const hi = Number(anyPercent[1]);
    if (Number.isFinite(hi)) {
      return { tier: tierForBoundary(hi), wasDefault: false };
    }
  }
  return { tier: "lvr_80-85%", wasDefault: true };
}
__name(normalizeLvrTier, "normalizeLvrTier");
function normalizeFeatureSet(text, annualFee) {
  const t = lower(text);
  if (t.includes("package") || t.includes("advantage") || t.includes("premium") || t.includes("offset") || annualFee != null && annualFee > 0) {
    return "premium";
  }
  return "basic";
}
__name(normalizeFeatureSet, "normalizeFeatureSet");
function parseInterestRate(value) {
  const text = lower(value);
  if (text.includes("lvr") || text.includes("loan to value") || text.includes("ltv")) {
    return null;
  }
  const rate = normalizePercentValue(value);
  if (rate == null) return null;
  if (rate < MIN_RATE_PERCENT || rate > MAX_RATE_PERCENT) return null;
  return rate;
}
__name(parseInterestRate, "parseInterestRate");
function parseComparisonRate(value) {
  const text = lower(value);
  if (text.includes("lvr") || text.includes("loan to value") || text.includes("ltv")) {
    return null;
  }
  const rate = normalizePercentValue(value);
  if (rate == null) return null;
  if (rate < MIN_COMPARISON_RATE_PERCENT || rate > MAX_COMPARISON_RATE_PERCENT) return null;
  return rate;
}
__name(parseComparisonRate, "parseComparisonRate");
function parseAnnualFee(value) {
  const n = parseSingleNumberToken(value);
  if (n == null) return null;
  if (n < 0 || n > MAX_ANNUAL_FEE) return null;
  return n;
}
__name(parseAnnualFee, "parseAnnualFee");
function minConfidenceForFlag(flag) {
  const f = lower(flag);
  if (f.startsWith("cdr_")) return 0.9;
  if (f.startsWith("parsed_from_wayback")) return 0.82;
  if (f.startsWith("scraped_fallback")) return 0.95;
  return 0.85;
}
__name(minConfidenceForFlag, "minConfidenceForFlag");
function isProductNameLikelyRateProduct(name) {
  const normalized = lower(name);
  if (normalized.length < 6) return false;
  const blocked = [
    "disclaimer",
    "warning",
    "example",
    "cashback",
    "copyright",
    "privacy",
    "terms and conditions",
    "loan to value ratio",
    "lvr ",
    "tooltip"
  ];
  if (blocked.some((x) => normalized.includes(x))) return false;
  const helpfulTokens = ["home", "loan", "variable", "fixed", "owner", "invest", "rate", "offset", "package"];
  return helpfulTokens.some((x) => normalized.includes(x));
}
__name(isProductNameLikelyRateProduct, "isProductNameLikelyRateProduct");
function validateNormalizedRow(row) {
  const productName = normalizeProductName(row.productName);
  if (!productName) {
    return { ok: false, reason: "missing_product_name" };
  }
  if (!isProductNameLikelyRateProduct(productName)) {
    return { ok: false, reason: "product_name_not_rate_like" };
  }
  if (!row.productId || !row.productId.trim()) {
    return { ok: false, reason: "missing_product_id" };
  }
  if (!row.sourceUrl || !row.sourceUrl.trim()) {
    return { ok: false, reason: "missing_source_url" };
  }
  if (!Number.isFinite(row.interestRate) || row.interestRate < MIN_RATE_PERCENT || row.interestRate > MAX_RATE_PERCENT) {
    return { ok: false, reason: "interest_rate_out_of_bounds" };
  }
  if (row.comparisonRate != null && (!Number.isFinite(row.comparisonRate) || row.comparisonRate < MIN_COMPARISON_RATE_PERCENT || row.comparisonRate > MAX_COMPARISON_RATE_PERCENT)) {
    return { ok: false, reason: "comparison_rate_out_of_bounds" };
  }
  if (row.comparisonRate != null && row.comparisonRate + 0.01 < row.interestRate) {
    return { ok: false, reason: "comparison_rate_below_interest_rate" };
  }
  if (row.annualFee != null && (!Number.isFinite(row.annualFee) || row.annualFee < 0 || row.annualFee > MAX_ANNUAL_FEE)) {
    return { ok: false, reason: "annual_fee_out_of_bounds" };
  }
  const minConfidence = minConfidenceForFlag(row.dataQualityFlag);
  if (!Number.isFinite(row.confidenceScore) || row.confidenceScore < minConfidence || row.confidenceScore > 1) {
    return { ok: false, reason: "confidence_out_of_bounds" };
  }
  return { ok: true };
}
__name(validateNormalizedRow, "validateNormalizedRow");

// src/ingest/lender-playbooks.ts
var COMMON_INCLUDE = ["home", "loan", "fixed", "variable", "owner", "invest"];
var COMMON_EXCLUDE = [
  "disclaimer",
  "warning",
  "tooltip",
  "cashback",
  "lvr",
  "loan to value",
  "terms and conditions",
  "privacy",
  "copyright",
  "example"
];
var PLAYBOOKS = {
  cba: {
    code: "cba",
    cdrVersions: [3, 4, 5, 6, 2, 1],
    minRatePercent: 0.5,
    maxRatePercent: 20,
    dailyMinConfidence: 0.92,
    historicalMinConfidence: 0.84,
    includeKeywords: [...COMMON_INCLUDE, "commbank"],
    excludeKeywords: COMMON_EXCLUDE
  },
  westpac: {
    code: "westpac",
    cdrVersions: [3, 4, 5, 6, 2, 1],
    minRatePercent: 0.5,
    maxRatePercent: 20,
    dailyMinConfidence: 0.92,
    historicalMinConfidence: 0.84,
    includeKeywords: [...COMMON_INCLUDE, "westpac", "rocket", "flexi"],
    excludeKeywords: COMMON_EXCLUDE
  },
  nab: {
    code: "nab",
    cdrVersions: [3, 4, 5, 6, 2, 1],
    minRatePercent: 0.5,
    maxRatePercent: 20,
    dailyMinConfidence: 0.92,
    historicalMinConfidence: 0.84,
    includeKeywords: [...COMMON_INCLUDE, "nab"],
    excludeKeywords: COMMON_EXCLUDE
  },
  anz: {
    code: "anz",
    cdrVersions: [3, 4, 5, 6, 2, 1],
    minRatePercent: 0.5,
    maxRatePercent: 20,
    dailyMinConfidence: 0.93,
    historicalMinConfidence: 0.85,
    includeKeywords: [...COMMON_INCLUDE, "anz"],
    excludeKeywords: [...COMMON_EXCLUDE, "estimated"]
  },
  macquarie: {
    code: "macquarie",
    cdrVersions: [3, 4, 5, 6, 2, 1],
    minRatePercent: 0.5,
    maxRatePercent: 20,
    dailyMinConfidence: 0.92,
    historicalMinConfidence: 0.84,
    includeKeywords: [...COMMON_INCLUDE, "macquarie"],
    excludeKeywords: COMMON_EXCLUDE
  },
  bendigo_adelaide: {
    code: "bendigo_adelaide",
    cdrVersions: [3, 4, 5, 6, 2, 1],
    minRatePercent: 0.5,
    maxRatePercent: 20,
    dailyMinConfidence: 0.92,
    historicalMinConfidence: 0.84,
    includeKeywords: [...COMMON_INCLUDE, "bendigo", "adelaide"],
    excludeKeywords: COMMON_EXCLUDE
  },
  suncorp: {
    code: "suncorp",
    cdrVersions: [3, 4, 5, 6, 2, 1],
    minRatePercent: 0.5,
    maxRatePercent: 20,
    dailyMinConfidence: 0.92,
    historicalMinConfidence: 0.84,
    includeKeywords: [...COMMON_INCLUDE, "suncorp"],
    excludeKeywords: COMMON_EXCLUDE
  },
  bankwest: {
    code: "bankwest",
    cdrVersions: [3, 4, 5, 6, 2, 1],
    minRatePercent: 0.5,
    maxRatePercent: 20,
    dailyMinConfidence: 0.92,
    historicalMinConfidence: 0.84,
    includeKeywords: [...COMMON_INCLUDE, "bankwest"],
    excludeKeywords: COMMON_EXCLUDE
  },
  ing: {
    code: "ing",
    cdrVersions: [3, 4, 5, 6, 2, 1],
    minRatePercent: 0.5,
    maxRatePercent: 20,
    dailyMinConfidence: 0.92,
    historicalMinConfidence: 0.84,
    includeKeywords: [...COMMON_INCLUDE, "ing"],
    excludeKeywords: COMMON_EXCLUDE
  },
  amp: {
    code: "amp",
    cdrVersions: [3, 4, 5, 6, 2, 1],
    minRatePercent: 0.5,
    maxRatePercent: 20,
    dailyMinConfidence: 0.92,
    historicalMinConfidence: 0.84,
    includeKeywords: [...COMMON_INCLUDE, "amp"],
    excludeKeywords: COMMON_EXCLUDE
  },
  hsbc: {
    code: "hsbc",
    cdrVersions: [3, 4, 5, 6, 2, 1],
    minRatePercent: 0.5,
    maxRatePercent: 20,
    dailyMinConfidence: 0.92,
    historicalMinConfidence: 0.84,
    includeKeywords: [...COMMON_INCLUDE, "hsbc"],
    excludeKeywords: COMMON_EXCLUDE
  },
  ubank: {
    code: "ubank",
    cdrVersions: [3, 4, 5, 6, 2, 1],
    minRatePercent: 0.5,
    maxRatePercent: 20,
    dailyMinConfidence: 0.92,
    historicalMinConfidence: 0.84,
    includeKeywords: [...COMMON_INCLUDE, "ubank", "86400"],
    excludeKeywords: COMMON_EXCLUDE
  },
  stgeorge: {
    code: "stgeorge",
    cdrVersions: [3, 4, 5, 6, 2, 1],
    minRatePercent: 0.5,
    maxRatePercent: 20,
    dailyMinConfidence: 0.92,
    historicalMinConfidence: 0.84,
    includeKeywords: [...COMMON_INCLUDE, "st george", "st.george"],
    excludeKeywords: COMMON_EXCLUDE
  },
  bankofmelbourne: {
    code: "bankofmelbourne",
    cdrVersions: [3, 4, 5, 6, 2, 1],
    minRatePercent: 0.5,
    maxRatePercent: 20,
    dailyMinConfidence: 0.92,
    historicalMinConfidence: 0.84,
    includeKeywords: [...COMMON_INCLUDE, "bank of melbourne"],
    excludeKeywords: COMMON_EXCLUDE
  },
  boq: {
    code: "boq",
    cdrVersions: [3, 4, 5, 6, 2, 1],
    minRatePercent: 0.5,
    maxRatePercent: 20,
    dailyMinConfidence: 0.92,
    historicalMinConfidence: 0.84,
    includeKeywords: [...COMMON_INCLUDE, "boq", "queensland"],
    excludeKeywords: COMMON_EXCLUDE
  },
  great_southern: {
    code: "great_southern",
    cdrVersions: [3, 4, 5, 6, 2, 1],
    minRatePercent: 0.5,
    maxRatePercent: 20,
    dailyMinConfidence: 0.92,
    historicalMinConfidence: 0.84,
    includeKeywords: [...COMMON_INCLUDE, "great southern"],
    excludeKeywords: COMMON_EXCLUDE
  }
};
var DEFAULT_PLAYBOOK = {
  code: "default",
  cdrVersions: [3, 4, 5, 6, 2, 1],
  minRatePercent: 0.5,
  maxRatePercent: 20,
  dailyMinConfidence: 0.92,
  historicalMinConfidence: 0.84,
  includeKeywords: COMMON_INCLUDE,
  excludeKeywords: COMMON_EXCLUDE
};
function getLenderPlaybook(lender) {
  return PLAYBOOKS[lender.code] || DEFAULT_PLAYBOOK;
}
__name(getLenderPlaybook, "getLenderPlaybook");

// src/ingest/cdr.ts
function isRecord(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
__name(isRecord, "isRecord");
function asArray(v) {
  return Array.isArray(v) ? v : [];
}
__name(asArray, "asArray");
function getText(v) {
  if (v == null) return "";
  return String(v).trim();
}
__name(getText, "getText");
function pickText(obj, keys) {
  for (const key of keys) {
    const v = obj[key];
    const text = getText(v);
    if (text) return text;
  }
  return "";
}
__name(pickText, "pickText");
function safeUrl(value) {
  return value.replace(/\/+$/, "");
}
__name(safeUrl, "safeUrl");
async function fetchTextWithRetries(url, retries = 2, headers = { accept: "application/json" }) {
  let lastStatus = 0;
  let lastText = "";
  for (let i = 0; i <= retries; i += 1) {
    try {
      const res = await fetch(url, {
        headers
      });
      const text = await res.text();
      lastStatus = res.status;
      lastText = text;
      if (res.ok) {
        return { ok: true, status: res.status, text };
      }
    } catch (error) {
      lastText = error?.message || String(error);
    }
  }
  return { ok: false, status: lastStatus || 500, text: lastText };
}
__name(fetchTextWithRetries, "fetchTextWithRetries");
function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
__name(parseJsonSafe, "parseJsonSafe");
async function fetchJson(url) {
  const response = await fetchTextWithRetries(url, 2, { accept: "application/json" });
  const data = parseJsonSafe(response.text);
  return {
    ok: response.ok && data != null,
    status: response.status,
    url,
    data,
    text: response.text
  };
}
__name(fetchJson, "fetchJson");
function parseSupportedVersions(body) {
  const m = body.match(/Versions available:\s*([0-9,\s]+)/i);
  if (!m) return [];
  return m[1].split(",").map((x) => Number(x.trim())).filter((x) => Number.isFinite(x));
}
__name(parseSupportedVersions, "parseSupportedVersions");
async function fetchCdrJson(url, versions) {
  const tried = /* @__PURE__ */ new Set();
  const queue = [...versions];
  while (queue.length > 0) {
    const version = Number(queue.shift());
    if (!Number.isFinite(version) || tried.has(version)) continue;
    tried.add(version);
    try {
      const res = await fetch(url, {
        headers: {
          accept: "application/json",
          "x-v": String(version),
          "x-min-v": "1"
        }
      });
      const text = await res.text();
      const data = parseJsonSafe(text);
      if (res.ok && data != null) {
        return {
          ok: true,
          status: res.status,
          url,
          data,
          text
        };
      }
      if (res.status === 406) {
        const advertised = parseSupportedVersions(text);
        for (const x of advertised) {
          if (!tried.has(x)) queue.push(x);
        }
      }
    } catch {
    }
  }
  for (const fallbackVersion of [1, 2, 3, 4, 5, 6]) {
    if (tried.has(fallbackVersion)) continue;
    try {
      const res = await fetch(url, {
        headers: {
          accept: "application/json",
          "x-v": String(fallbackVersion),
          "x-min-v": "1"
        }
      });
      const text = await res.text();
      const data = parseJsonSafe(text);
      if (res.ok && data != null) {
        return {
          ok: true,
          status: res.status,
          url,
          data,
          text
        };
      }
    } catch {
    }
  }
  return fetchJson(url);
}
__name(fetchCdrJson, "fetchCdrJson");
function extractBrands(payload) {
  const out = [];
  const dataArray = isRecord(payload) ? asArray(payload.data) : asArray(payload);
  for (const item of dataArray) {
    if (!isRecord(item)) continue;
    const brandName = pickText(item, ["brandName", "dataHolderBrandName"]);
    const legalEntityName = isRecord(item.legalEntity) ? pickText(item.legalEntity, ["legalEntityName"]) : "";
    const endpointDetail = isRecord(item.endpointDetail) ? item.endpointDetail : {};
    const endpointUrlRaw = pickText(endpointDetail, ["productReferenceDataApi"]) || pickText(endpointDetail, ["publicBaseUri"]) || pickText(endpointDetail, ["resourceBaseUri"]) || pickText(item, ["publicBaseUri"]) || pickText(item, ["resourceBaseUri"]);
    if (!endpointUrlRaw) continue;
    const endpointUrl = endpointUrlRaw.includes("/cds-au/v1/banking/products") ? endpointUrlRaw : `${safeUrl(endpointUrlRaw)}/cds-au/v1/banking/products`;
    out.push({
      brandName,
      legalEntityName,
      endpointUrl
    });
  }
  return out;
}
__name(extractBrands, "extractBrands");
function lenderMatchesBrand(lender, brand) {
  const haystack = `${brand.brandName} ${brand.legalEntityName}`.toLowerCase();
  const needles = [lender.register_brand_name, lender.canonical_bank_name, lender.name];
  for (const needle of needles) {
    const n = getText(needle).toLowerCase();
    if (n && haystack.includes(n)) {
      return true;
    }
  }
  return false;
}
__name(lenderMatchesBrand, "lenderMatchesBrand");
async function discoverProductsEndpoint(lender) {
  const registerUrls = [
    "https://api.cdr.gov.au/cdr-register/v1/all/data-holders/brands/summary",
    "https://api.cdr.gov.au/cdr-register/v1/banking/data-holders/brands",
    "https://api.cdr.gov.au/cdr-register/v1/banking/register"
  ];
  for (const registerUrl of registerUrls) {
    const fetched = registerUrl.includes("/all/data-holders/brands/summary") ? await fetchCdrJson(registerUrl, [1, 2, 3, 4, 5, 6]) : await fetchJson(registerUrl);
    if (!fetched.ok) {
      continue;
    }
    const brands = extractBrands(fetched.data);
    const hit = brands.find((brand) => lenderMatchesBrand(lender, brand));
    if (hit) {
      return {
        endpointUrl: hit.endpointUrl,
        sourceUrl: registerUrl,
        status: fetched.status,
        notes: `matched_brand:${hit.brandName || lender.name}`
      };
    }
  }
  if (lender.products_endpoint) {
    return {
      endpointUrl: lender.products_endpoint,
      sourceUrl: "lenders.json",
      status: 200,
      notes: "configured_products_endpoint"
    };
  }
  return null;
}
__name(discoverProductsEndpoint, "discoverProductsEndpoint");
function extractProducts(payload) {
  if (!isRecord(payload)) return [];
  const data = isRecord(payload.data) ? asArray(payload.data.products) : asArray(payload.data);
  return data.filter(isRecord);
}
__name(extractProducts, "extractProducts");
function nextLink(payload) {
  if (!isRecord(payload)) return null;
  const links = isRecord(payload.links) ? payload.links : null;
  const next = links ? getText(links.next) : "";
  return next || null;
}
__name(nextLink, "nextLink");
function isResidentialMortgage(product) {
  const category = pickText(product, ["productCategory", "category", "type"]).toUpperCase();
  const name = pickText(product, ["name", "productName"]).toUpperCase();
  return category.includes("MORTGAGE") || name.includes("MORTGAGE") || name.includes("HOME LOAN");
}
__name(isResidentialMortgage, "isResidentialMortgage");
function extractRatesArray(detail) {
  const arrays = [detail.lendingRates, detail.rates, detail.rateTiers, detail.rate];
  for (const candidate of arrays) {
    const arr = asArray(candidate).filter(isRecord);
    if (arr.length > 0) return arr;
  }
  return [];
}
__name(extractRatesArray, "extractRatesArray");
function collectConstraintText(rate, detail) {
  const fromRate = [pickText(rate, ["additionalInfo", "additionalValue", "name", "lendingRateType"])];
  const constraints = asArray(rate.constraints).filter(isRecord);
  for (const c of constraints) {
    fromRate.push(JSON.stringify(c));
  }
  const detailHints = [pickText(detail, ["description", "name", "productName"])];
  return [...fromRate, ...detailHints].filter(Boolean).join(" | ");
}
__name(collectConstraintText, "collectConstraintText");
function parseLvrFromText(text) {
  const t = text.toLowerCase();
  if (!t.includes("lvr") && !t.includes("loan to value") && !t.includes("ltv")) return null;
  const range = t.match(/(\d{1,3}(?:\.\d+)?)\s*(?:%\s*)?(?:-|to)\s*(\d{1,3}(?:\.\d+)?)\s*%?/);
  if (range) {
    const lo = Number(range[1]);
    const hi = Number(range[2]);
    if (Number.isFinite(lo) && Number.isFinite(hi)) return { min: lo, max: hi };
  }
  const le = t.match(/(?:<=|≤|under|up to|maximum|max|below)\s*(\d{1,3}(?:\.\d+)?)\s*%?/);
  if (le) {
    const hi = Number(le[1]);
    if (Number.isFinite(hi)) return { min: null, max: hi };
  }
  const ge = t.match(/(?:>=|≥|over|above|from|greater than)\s*(\d{1,3}(?:\.\d+)?)\s*%?/);
  if (ge) {
    const lo = Number(ge[1]);
    if (Number.isFinite(lo)) return { min: lo, max: null };
  }
  const single = t.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  if (single) {
    const n = Number(single[1]);
    if (Number.isFinite(n) && n <= 100) return { min: null, max: n };
  }
  return null;
}
__name(parseLvrFromText, "parseLvrFromText");
function parseLvrBounds(rate) {
  const constraints = asArray(rate.constraints).filter(isRecord);
  for (const c of constraints) {
    const t = pickText(c, ["constraintType"]).toLowerCase();
    if (!t.includes("lvr")) continue;
    const min = Number.isFinite(Number(c.minValue)) ? Number(c.minValue) : null;
    const max = Number.isFinite(Number(c.maxValue)) ? Number(c.maxValue) : null;
    if (min != null || max != null) return { min, max };
  }
  const tiers = asArray(rate.tiers).filter(isRecord);
  for (const tier of tiers) {
    const tierName = pickText(tier, ["name", "unitOfMeasure", "rateApplicationMethod"]).toLowerCase();
    if (!tierName.includes("lvr") && !tierName.includes("loan to value")) continue;
    const min = Number.isFinite(Number(tier.minimumValue)) ? Number(tier.minimumValue) : null;
    const max = Number.isFinite(Number(tier.maximumValue)) ? Number(tier.maximumValue) : null;
    if (min != null || max != null) return { min, max };
  }
  const additionalValue = getText(rate.additionalValue);
  if (additionalValue) {
    const fromAdditional = parseLvrFromText(additionalValue);
    if (fromAdditional) return fromAdditional;
  }
  const additionalInfo = getText(rate.additionalInfo);
  if (additionalInfo) {
    const fromInfo = parseLvrFromText(additionalInfo);
    if (fromInfo) return fromInfo;
  }
  return { min: null, max: null };
}
__name(parseLvrBounds, "parseLvrBounds");
function parseAnnualFeeFromDetail(detail) {
  const fees = asArray(detail.fees).filter(isRecord);
  for (const fee of fees) {
    const feeType = pickText(fee, ["feeType", "name"]).toLowerCase();
    if (!feeType.includes("annual") && !feeType.includes("package")) {
      continue;
    }
    const fixedAmount = isRecord(fee.fixedAmount) ? fee.fixedAmount : null;
    const amount = parseAnnualFee(fee.amount) ?? parseAnnualFee(fee.additionalValue) ?? parseAnnualFee(fixedAmount ? fixedAmount.amount : null);
    if (amount != null) {
      return amount;
    }
  }
  return null;
}
__name(parseAnnualFeeFromDetail, "parseAnnualFeeFromDetail");
function parseRatesFromDetail(input) {
  const detail = input.detail;
  const productId = pickText(detail, ["productId", "id"]);
  const productName = normalizeProductName(pickText(detail, ["name", "productName"]));
  if (!productId || !productName || !isProductNameLikelyRateProduct(productName)) {
    return [];
  }
  const rates = extractRatesArray(detail);
  const annualFee = parseAnnualFeeFromDetail(detail);
  const result = [];
  const playbook = getLenderPlaybook(input.lender);
  for (const rate of rates) {
    const rawInterestValue = rate.rate ?? rate.interestRate ?? rate.value;
    const interestRate = parseInterestRate(rawInterestValue);
    if (interestRate == null) {
      continue;
    }
    if (interestRate < playbook.minRatePercent || interestRate > playbook.maxRatePercent) {
      continue;
    }
    const comparisonRate = parseComparisonRate(rate.comparisonRate ?? rate.comparison ?? rate.comparison_value);
    const contextText = collectConstraintText(rate, detail);
    const lvr = parseLvrBounds(rate);
    const contextLower = contextText.toLowerCase();
    if (playbook.excludeKeywords.some((x) => contextLower.includes(x))) {
      continue;
    }
    const lvrResult = normalizeLvrTier(contextText, lvr.min, lvr.max);
    let confidence = 0.95;
    if (!comparisonRate) confidence -= 0.04;
    if (lvrResult.wasDefault) confidence -= 0.05;
    if (!contextLower.includes("loan")) confidence -= 0.02;
    const lendingRateType = pickText(rate, ["lendingRateType"]);
    const repaymentText = `${lendingRateType} ${pickText(rate, ["repaymentType"])} ${pickText(detail, ["repaymentType"])} ${contextText}`;
    const rateStructureText = `${lendingRateType} ${pickText(rate, ["name"])} ${pickText(detail, ["name"])} ${contextText}`;
    const rawPurpose = `${pickText(rate, ["loanPurpose"])} ${pickText(detail, ["loanPurpose"])}`.toLowerCase();
    const isBothPurpose = rawPurpose.includes("both");
    const purposes = isBothPurpose ? ["owner_occupied", "investment"] : [normalizeSecurityPurpose(`${rawPurpose} ${contextText}`)];
    for (const securityPurpose of purposes) {
      const row = {
        bankName: normalizeBankName(input.lender.canonical_bank_name, input.lender.name),
        collectionDate: input.collectionDate,
        productId,
        productName,
        securityPurpose,
        repaymentType: normalizeRepaymentType(repaymentText),
        rateStructure: normalizeRateStructure(rateStructureText),
        lvrTier: lvrResult.tier,
        featureSet: normalizeFeatureSet(`${productName} ${contextText}`, annualFee),
        interestRate,
        comparisonRate,
        annualFee,
        sourceUrl: input.sourceUrl,
        dataQualityFlag: "cdr_live",
        confidenceScore: Number(Math.max(0.6, Math.min(0.99, confidence)).toFixed(3))
      };
      result.push(row);
    }
  }
  return result;
}
__name(parseRatesFromDetail, "parseRatesFromDetail");
async function fetchResidentialMortgageProductIds(endpointUrl, pageLimit = 20, options) {
  const ids = /* @__PURE__ */ new Set();
  const payloads = [];
  let url = endpointUrl;
  let pages = 0;
  const versions = options?.cdrVersions && options.cdrVersions.length > 0 ? options.cdrVersions : [6, 5, 4, 3];
  while (url && pages < pageLimit) {
    pages += 1;
    const response = await fetchCdrJson(url, versions);
    payloads.push({
      sourceUrl: url,
      status: response.status,
      body: response.text
    });
    if (!response.ok || !response.data) {
      break;
    }
    const products = extractProducts(response.data);
    for (const product of products) {
      if (!isResidentialMortgage(product)) continue;
      const id = pickText(product, ["productId", "id"]);
      if (id) ids.add(id);
    }
    url = nextLink(response.data);
  }
  return {
    productIds: Array.from(ids),
    rawPayloads: payloads
  };
}
__name(fetchResidentialMortgageProductIds, "fetchResidentialMortgageProductIds");
async function fetchProductDetailRows(input) {
  const detailUrl = `${safeUrl(input.endpointUrl)}/${encodeURIComponent(input.productId)}`;
  const versions = input.cdrVersions && input.cdrVersions.length > 0 ? input.cdrVersions : [6, 5, 4, 3];
  const fetched = await fetchCdrJson(detailUrl, versions);
  const rawPayload = {
    sourceUrl: detailUrl,
    status: fetched.status,
    body: fetched.text
  };
  if (!fetched.ok || !isRecord(fetched.data)) {
    return { rows: [], rawPayload };
  }
  const detail = isRecord(fetched.data.data) ? fetched.data.data : fetched.data;
  return {
    rows: parseRatesFromDetail({
      lender: input.lender,
      detail,
      sourceUrl: detailUrl,
      collectionDate: input.collectionDate
    }),
    rawPayload
  };
}
__name(fetchProductDetailRows, "fetchProductDetailRows");
function buildBackfillCursorKey(lenderCode, monthCursor, seedUrl) {
  return `${lenderCode}|${monthCursor}|${seedUrl}`;
}
__name(buildBackfillCursorKey, "buildBackfillCursorKey");
function cdrCollectionNotes(productCount, rowCount) {
  return `cdr_collection products=${productCount} rows=${rowCount} at=${nowIso()}`;
}
__name(cdrCollectionNotes, "cdrCollectionNotes");

// src/db/endpoint-cache.ts
async function getCachedEndpoint(db, lenderCode, now = nowIso()) {
  const row = await db.prepare(
    `SELECT endpoint_url, expires_at
       FROM lender_endpoint_cache
       WHERE lender_code = ?1
       LIMIT 1`
  ).bind(lenderCode).first();
  if (!row) {
    return null;
  }
  if (row.expires_at <= now) {
    return null;
  }
  return {
    endpointUrl: row.endpoint_url,
    expiresAt: row.expires_at
  };
}
__name(getCachedEndpoint, "getCachedEndpoint");
async function upsertEndpointCache(db, input) {
  await db.prepare(
    `INSERT INTO lender_endpoint_cache (
         lender_code,
         endpoint_url,
         fetched_at,
         expires_at,
         source_url,
         http_status,
         notes
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(lender_code) DO UPDATE SET
         endpoint_url = excluded.endpoint_url,
         fetched_at = excluded.fetched_at,
         expires_at = excluded.expires_at,
         source_url = excluded.source_url,
         http_status = excluded.http_status,
         notes = excluded.notes`
  ).bind(
    input.lenderCode,
    input.endpointUrl,
    nowIso(),
    input.expiresAt,
    input.sourceUrl ?? null,
    input.httpStatus ?? null,
    input.notes ?? null
  ).run();
}
__name(upsertEndpointCache, "upsertEndpointCache");
async function refreshEndpointCache(db, lenders, ttlHours = 24) {
  const now = Date.now();
  const expiresAt = new Date(now + ttlHours * 3600 * 1e3).toISOString();
  const failed = [];
  let refreshed = 0;
  for (const lender of lenders) {
    const discovered = await discoverProductsEndpoint(lender);
    if (!discovered) {
      failed.push(lender.code);
      continue;
    }
    await upsertEndpointCache(db, {
      lenderCode: lender.code,
      endpointUrl: discovered.endpointUrl,
      expiresAt,
      sourceUrl: discovered.sourceUrl || CDR_REGISTER_DISCOVERY_URL,
      httpStatus: discovered.status,
      notes: discovered.notes
    });
    refreshed += 1;
  }
  return { refreshed, failed };
}
__name(refreshEndpointCache, "refreshEndpointCache");

// src/db/run-reports.ts
function parseJson(raw2, fallback) {
  try {
    if (!raw2) {
      return fallback;
    }
    return JSON.parse(raw2);
  } catch {
    return fallback;
  }
}
__name(parseJson, "parseJson");
function asPerLenderSummary(input) {
  const now = nowIso();
  if (!input || typeof input !== "object") {
    return {
      _meta: {
        enqueued_total: 0,
        processed_total: 0,
        failed_total: 0,
        updated_at: now
      }
    };
  }
  const raw2 = input;
  const rawMeta = raw2._meta || {};
  return {
    ...raw2,
    _meta: {
      enqueued_total: Number(rawMeta.enqueued_total) || 0,
      processed_total: Number(rawMeta.processed_total) || 0,
      failed_total: Number(rawMeta.failed_total) || 0,
      updated_at: String(rawMeta.updated_at || now)
    }
  };
}
__name(asPerLenderSummary, "asPerLenderSummary");
function asLenderProgress(input) {
  const now = nowIso();
  if (!input || typeof input !== "object") {
    return {
      enqueued: 0,
      processed: 0,
      failed: 0,
      updated_at: now
    };
  }
  const raw2 = input;
  return {
    enqueued: Number(raw2.enqueued) || 0,
    processed: Number(raw2.processed) || 0,
    failed: Number(raw2.failed) || 0,
    last_error: raw2.last_error == null ? void 0 : String(raw2.last_error),
    updated_at: String(raw2.updated_at || now)
  };
}
__name(asLenderProgress, "asLenderProgress");
function buildInitialPerLenderSummary(perLenderEnqueued) {
  const now = nowIso();
  const entries = Object.entries(perLenderEnqueued);
  const summary = {
    _meta: {
      enqueued_total: entries.reduce((sum, [, count]) => sum + count, 0),
      processed_total: 0,
      failed_total: 0,
      updated_at: now
    }
  };
  for (const [lenderCode, count] of entries) {
    summary[lenderCode] = {
      enqueued: count,
      processed: 0,
      failed: 0,
      updated_at: now
    };
  }
  return summary;
}
__name(buildInitialPerLenderSummary, "buildInitialPerLenderSummary");
async function getRunReport(db, runId) {
  const row = await db.prepare(
    `SELECT run_id, run_type, run_source, started_at, finished_at, status, per_lender_json, errors_json
       FROM run_reports
       WHERE run_id = ?1`
  ).bind(runId).first();
  return row ?? null;
}
__name(getRunReport, "getRunReport");
async function listRunReports(db, limit = 25) {
  const safeLimit4 = Math.min(100, Math.max(1, Math.floor(limit)));
  const rows4 = await db.prepare(
    `SELECT run_id, run_type, run_source, started_at, finished_at, status, per_lender_json, errors_json
       FROM run_reports
       ORDER BY started_at DESC
       LIMIT ?1`
  ).bind(safeLimit4).all();
  return rows4.results ?? [];
}
__name(listRunReports, "listRunReports");
async function createRunReport(db, input) {
  const startedAt = input.startedAt || nowIso();
  const runSource = input.runSource ?? "scheduled";
  const perLenderJson = JSON.stringify(
    asPerLenderSummary(input.perLenderSummary || {
      _meta: {
        enqueued_total: 0,
        processed_total: 0,
        failed_total: 0,
        updated_at: startedAt
      }
    })
  );
  const insert = await db.prepare(
    `INSERT INTO run_reports (run_id, run_type, run_source, started_at, status, per_lender_json, errors_json)
       VALUES (?1, ?2, ?3, ?4, 'running', ?5, '[]')
       ON CONFLICT(run_id) DO NOTHING`
  ).bind(input.runId, input.runType, runSource, startedAt, perLenderJson).run();
  const row = await getRunReport(db, input.runId);
  if (!row) {
    throw new Error(`Failed to load run report after create: ${input.runId}`);
  }
  return {
    created: Number(insert.meta?.changes || 0) > 0,
    row
  };
}
__name(createRunReport, "createRunReport");
async function setRunEnqueuedSummary(db, runId, perLenderSummary) {
  const summary = asPerLenderSummary(perLenderSummary);
  summary._meta.updated_at = nowIso();
  await db.prepare(
    `UPDATE run_reports
       SET per_lender_json = ?1,
           status = 'running',
           finished_at = NULL
       WHERE run_id = ?2`
  ).bind(JSON.stringify(summary), runId).run();
  return getRunReport(db, runId);
}
__name(setRunEnqueuedSummary, "setRunEnqueuedSummary");
async function markRunFailed(db, runId, errorMessage) {
  const row = await getRunReport(db, runId);
  if (!row) {
    return null;
  }
  const errors = parseJson(row.errors_json, []);
  errors.push(`[${nowIso()}] ${errorMessage}`);
  await db.prepare(
    `UPDATE run_reports
       SET status = 'failed',
           finished_at = ?1,
           errors_json = ?2
       WHERE run_id = ?3`
  ).bind(nowIso(), JSON.stringify(errors.slice(-200)), runId).run();
  return getRunReport(db, runId);
}
__name(markRunFailed, "markRunFailed");
async function recordRunQueueOutcome(db, input) {
  const row = await getRunReport(db, input.runId);
  if (!row) {
    return null;
  }
  const summary = asPerLenderSummary(parseJson(row.per_lender_json, {}));
  const errors = parseJson(row.errors_json, []);
  const now = nowIso();
  const lenderCode = input.lenderCode || "_unknown";
  const progress = asLenderProgress(summary[lenderCode]);
  if (input.success) {
    progress.processed += 1;
    summary._meta.processed_total += 1;
  } else {
    progress.failed += 1;
    summary._meta.failed_total += 1;
    if (input.errorMessage) {
      progress.last_error = input.errorMessage;
      errors.push(`[${now}] ${lenderCode}: ${input.errorMessage}`);
    }
  }
  progress.updated_at = now;
  summary[lenderCode] = progress;
  summary._meta.updated_at = now;
  const completedTotal = summary._meta.processed_total + summary._meta.failed_total;
  const enqueuedTotal = summary._meta.enqueued_total;
  let nextStatus = row.status;
  let finishedAt = row.finished_at;
  if (enqueuedTotal > 0 && completedTotal >= enqueuedTotal) {
    nextStatus = summary._meta.failed_total > 0 ? "partial" : "ok";
    finishedAt = now;
  } else if (!input.success && enqueuedTotal === 0) {
    nextStatus = "partial";
  }
  await db.prepare(
    `UPDATE run_reports
       SET per_lender_json = ?1,
           errors_json = ?2,
           status = ?3,
           finished_at = ?4
       WHERE run_id = ?5`
  ).bind(JSON.stringify(summary), JSON.stringify(errors.slice(-200)), nextStatus, finishedAt, input.runId).run();
  return getRunReport(db, input.runId);
}
__name(recordRunQueueOutcome, "recordRunQueueOutcome");
async function getLastManualRunStartedAt(db) {
  const row = await db.prepare(
    `SELECT started_at FROM run_reports
       WHERE run_source = 'manual' AND run_type = 'daily'
       ORDER BY started_at DESC
       LIMIT 1`
  ).first();
  return row?.started_at ?? null;
}
__name(getLastManualRunStartedAt, "getLastManualRunStartedAt");

// src/db/rba-cash-rate.ts
async function upsertRbaCashRate(db, input) {
  await db.prepare(
    `INSERT INTO rba_cash_rates (
        collection_date,
        cash_rate,
        effective_date,
        source_url,
        fetched_at
      ) VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)
      ON CONFLICT(collection_date) DO UPDATE SET
        cash_rate = excluded.cash_rate,
        effective_date = excluded.effective_date,
        source_url = excluded.source_url,
        fetched_at = CURRENT_TIMESTAMP`
  ).bind(input.collectionDate, input.cashRate, input.effectiveDate, input.sourceUrl).run();
}
__name(upsertRbaCashRate, "upsertRbaCashRate");

// src/ingest/rba.ts
var RBA_F1_DATA_URL = "https://www.rba.gov.au/statistics/tables/csv/f1-data.csv";
var MONTHS = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12"
};
function toIsoDate(value) {
  const m = value.trim().match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${month}-${m[1]}`;
}
__name(toIsoDate, "toIsoDate");
function parseCsvLines(csv) {
  const lines = csv.split(/\r?\n/);
  const points = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(",");
    if (parts.length < 2) continue;
    const isoDate = toIsoDate(parts[0]);
    if (!isoDate) continue;
    const cashRate = Number(parts[1]);
    if (!Number.isFinite(cashRate)) continue;
    points.push({
      date: isoDate,
      cashRate
    });
  }
  return points;
}
__name(parseCsvLines, "parseCsvLines");
function latestPointOnOrBefore(points, collectionDate) {
  let best = null;
  for (const p of points) {
    if (p.date > collectionDate) continue;
    if (!best || p.date > best.date) {
      best = p;
    }
  }
  return best;
}
__name(latestPointOnOrBefore, "latestPointOnOrBefore");
async function collectRbaCashRateForDate(db, collectionDate) {
  try {
    const response = await fetch(RBA_F1_DATA_URL);
    const csv = await response.text();
    if (!response.ok) {
      return { ok: false, cashRate: null, effectiveDate: null, sourceUrl: RBA_F1_DATA_URL };
    }
    const points = parseCsvLines(csv);
    const nearest = latestPointOnOrBefore(points, collectionDate);
    if (!nearest) {
      return { ok: false, cashRate: null, effectiveDate: null, sourceUrl: RBA_F1_DATA_URL };
    }
    await upsertRbaCashRate(db, {
      collectionDate,
      cashRate: nearest.cashRate,
      effectiveDate: nearest.date,
      sourceUrl: RBA_F1_DATA_URL
    });
    return {
      ok: true,
      cashRate: nearest.cashRate,
      effectiveDate: nearest.date,
      sourceUrl: RBA_F1_DATA_URL
    };
  } catch {
    return { ok: false, cashRate: null, effectiveDate: null, sourceUrl: RBA_F1_DATA_URL };
  }
}
__name(collectRbaCashRateForDate, "collectRbaCashRateForDate");

// src/utils/idempotency.ts
function normalizeKeyPart(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
}
__name(normalizeKeyPart, "normalizeKeyPart");
function buildDailyRunId(collectionDate) {
  return `daily:${collectionDate}`;
}
__name(buildDailyRunId, "buildDailyRunId");
function buildScheduledRunId(collectionDate) {
  return `daily:${collectionDate}:${(/* @__PURE__ */ new Date()).toISOString()}`;
}
__name(buildScheduledRunId, "buildScheduledRunId");
function buildBackfillRunId(monthCursor) {
  return `backfill:${monthCursor}:${crypto.randomUUID()}`;
}
__name(buildBackfillRunId, "buildBackfillRunId");
function buildRunLockKey(runType, dateOrMonth) {
  return `${runType}:${dateOrMonth}`;
}
__name(buildRunLockKey, "buildRunLockKey");
function buildDailyLenderIdempotencyKey(runId, lenderCode) {
  return `daily:${normalizeKeyPart(runId)}:${normalizeKeyPart(lenderCode)}`;
}
__name(buildDailyLenderIdempotencyKey, "buildDailyLenderIdempotencyKey");
function buildBackfillIdempotencyKey(runId, lenderCode, seedUrl, monthCursor) {
  return [
    "backfill",
    normalizeKeyPart(runId),
    normalizeKeyPart(lenderCode),
    normalizeKeyPart(seedUrl),
    normalizeKeyPart(monthCursor)
  ].join(":");
}
__name(buildBackfillIdempotencyKey, "buildBackfillIdempotencyKey");
function extensionForSource(sourceType) {
  return sourceType === "wayback_html" ? "html" : "json";
}
__name(extensionForSource, "extensionForSource");
function buildRawR2Key(sourceType, fetchedAtIso, contentHash) {
  const [datePart] = fetchedAtIso.split("T");
  const [year2, month = "00", day2 = "00"] = (datePart || "1970-01-01").split("-");
  const ext = extensionForSource(sourceType);
  return `raw/${sourceType}/${year2}/${month}/${day2}/${contentHash}.${ext}`;
}
__name(buildRawR2Key, "buildRawR2Key");

// src/queue/producer.ts
function asQueueBatch(messages) {
  return messages.map((message2) => ({ body: message2 }));
}
__name(asQueueBatch, "asQueueBatch");
async function enqueueDailyLenderJobs(env, input) {
  const runSource = input.runSource ?? "scheduled";
  const jobs = input.lenders.map((lender) => ({
    kind: "daily_lender_fetch",
    runId: input.runId,
    runSource,
    lenderCode: lender.code,
    collectionDate: input.collectionDate,
    attempt: 0,
    idempotencyKey: buildDailyLenderIdempotencyKey(input.runId, lender.code)
  }));
  if (jobs.length > 0) {
    await env.INGEST_QUEUE.sendBatch(asQueueBatch(jobs));
  }
  return {
    enqueued: jobs.length,
    perLender: Object.fromEntries(jobs.map((job) => [job.lenderCode, 1]))
  };
}
__name(enqueueDailyLenderJobs, "enqueueDailyLenderJobs");
async function enqueueDailySavingsLenderJobs(env, input) {
  const runSource = input.runSource ?? "scheduled";
  const jobs = input.lenders.map((lender) => ({
    kind: "daily_savings_lender_fetch",
    runId: input.runId,
    runSource,
    lenderCode: lender.code,
    collectionDate: input.collectionDate,
    attempt: 0,
    idempotencyKey: `${input.runId}:savings:${lender.code}`
  }));
  if (jobs.length > 0) {
    await env.INGEST_QUEUE.sendBatch(asQueueBatch(jobs));
  }
  return {
    enqueued: jobs.length,
    perLender: Object.fromEntries(jobs.map((job) => [job.lenderCode, 1]))
  };
}
__name(enqueueDailySavingsLenderJobs, "enqueueDailySavingsLenderJobs");
async function enqueueBackfillJobs(env, input) {
  const runSource = input.runSource ?? "scheduled";
  const jobs = input.jobs.map((job) => ({
    kind: "backfill_snapshot_fetch",
    runId: input.runId,
    runSource,
    lenderCode: job.lenderCode,
    seedUrl: job.seedUrl,
    monthCursor: job.monthCursor,
    attempt: 0,
    idempotencyKey: buildBackfillIdempotencyKey(input.runId, job.lenderCode, job.seedUrl, job.monthCursor)
  }));
  if (jobs.length > 0) {
    await env.INGEST_QUEUE.sendBatch(asQueueBatch(jobs));
  }
  const perLender = {};
  for (const job of jobs) {
    perLender[job.lenderCode] = (perLender[job.lenderCode] || 0) + 1;
  }
  return {
    enqueued: jobs.length,
    perLender
  };
}
__name(enqueueBackfillJobs, "enqueueBackfillJobs");

// src/utils/logger.ts
var _db = null;
var _buffer = [];
var _pendingWrites = /* @__PURE__ */ new Set();
var MAX_BUFFER = 200;
function initLogger(db) {
  _db = db;
}
__name(initLogger, "initLogger");
function formatConsole(entry) {
  const parts = [`[${entry.level.toUpperCase()}] [${entry.source}]`, entry.message];
  if (entry.runId) parts.push(`run=${entry.runId}`);
  if (entry.lenderCode) parts.push(`lender=${entry.lenderCode}`);
  if (entry.context) parts.push(entry.context);
  return parts.join(" ");
}
__name(formatConsole, "formatConsole");
async function persist(entry) {
  if (!_db) return;
  try {
    await _db.prepare(
      `INSERT INTO global_log (level, source, message, context, run_id, lender_code)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    ).bind(
      entry.level,
      entry.source,
      entry.message.slice(0, 2e3),
      entry.context ? entry.context.slice(0, 4e3) : null,
      entry.runId ?? null,
      entry.lenderCode ?? null
    ).run();
  } catch {
  }
}
__name(persist, "persist");
function emit(entry) {
  const line = formatConsole(entry);
  if (entry.level === "error") {
    console.error(line);
  } else if (entry.level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
  if (_db) {
    const p = persist(entry);
    _pendingWrites.add(p);
    p.finally(() => _pendingWrites.delete(p));
  } else {
    if (_buffer.length < MAX_BUFFER) _buffer.push(entry);
  }
}
__name(emit, "emit");
async function flushBufferedLogs() {
  if (!_db) return;
  await Promise.all([..._pendingWrites]);
  if (_buffer.length === 0) return;
  const entries = _buffer.splice(0, _buffer.length);
  await Promise.all(entries.map((entry) => persist(entry)));
}
__name(flushBufferedLogs, "flushBufferedLogs");
var log2 = {
  debug(source, message2, ctx) {
    emit({ level: "debug", source, message: message2, ...ctx });
  },
  info(source, message2, ctx) {
    emit({ level: "info", source, message: message2, ...ctx });
  },
  warn(source, message2, ctx) {
    emit({ level: "warn", source, message: message2, ...ctx });
  },
  error(source, message2, ctx) {
    emit({ level: "error", source, message: message2, ...ctx });
  }
};
async function queryLogs(db, opts = {}) {
  const where = [];
  const binds = [];
  if (opts.level) {
    where.push("level = ?");
    binds.push(opts.level);
  }
  if (opts.source) {
    where.push("source = ?");
    binds.push(opts.source);
  }
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(1, opts.limit ?? 1e3), 1e4);
  const offset = Math.max(0, opts.offset ?? 0);
  const countSql = `SELECT COUNT(*) AS total FROM global_log ${whereClause}`;
  const countResult = await db.prepare(countSql).bind(...binds).first();
  const total = Number(countResult?.total ?? 0);
  const dataSql = `SELECT id, ts, level, source, message, context, run_id, lender_code FROM global_log ${whereClause} ORDER BY ts DESC LIMIT ? OFFSET ?`;
  const dataResult = await db.prepare(dataSql).bind(...binds, limit, offset).all();
  return { entries: dataResult.results ?? [], total };
}
__name(queryLogs, "queryLogs");
async function getLogStats(db) {
  const result = await db.prepare("SELECT COUNT(*) AS cnt, MAX(ts) AS latest_ts FROM global_log").first();
  return {
    count: Number(result?.cnt ?? 0),
    latest_ts: result?.latest_ts ?? null
  };
}
__name(getLogStats, "getLogStats");

// src/pipeline/bootstrap-jobs.ts
function filterLenders(codes) {
  if (!codes || codes.length === 0) {
    return TARGET_LENDERS;
  }
  const selected = new Set(codes.map((code) => code.toLowerCase().trim()));
  return TARGET_LENDERS.filter((lender) => selected.has(lender.code.toLowerCase()));
}
__name(filterLenders, "filterLenders");
function isMonthCursor(value) {
  return !!value && /^\d{4}-\d{2}$/.test(value);
}
__name(isMonthCursor, "isMonthCursor");
async function triggerDailyRun(env, options) {
  const melbourneParts = getMelbourneNowParts(/* @__PURE__ */ new Date(), env.MELBOURNE_TIMEZONE || MELBOURNE_TIMEZONE);
  const collectionDate = melbourneParts.date;
  const baseRunId = buildDailyRunId(collectionDate);
  const runId = options.runIdOverride ?? (options.force ? `${baseRunId}:force:${crypto.randomUUID()}` : baseRunId);
  const lockKey = buildRunLockKey("daily", collectionDate);
  const lockTtlSeconds = parseIntegerEnv(env.LOCK_TTL_SECONDS, DEFAULT_LOCK_TTL_SECONDS);
  let lockAcquired = false;
  if (!options.force) {
    const lock = await acquireRunLock(env, {
      key: lockKey,
      owner: runId,
      ttlSeconds: lockTtlSeconds
    });
    if (!lock.ok) {
      return {
        ok: false,
        skipped: true,
        reason: lock.reason || "lock_unavailable",
        runId,
        collectionDate
      };
    }
    if (!lock.acquired) {
      return {
        ok: true,
        skipped: true,
        reason: "daily_run_locked",
        runId,
        collectionDate
      };
    }
    lockAcquired = true;
  }
  const created = await createRunReport(env.DB, {
    runId,
    runType: "daily",
    runSource: options.source
  });
  if (!created.created && !options.force) {
    if (lockAcquired) {
      await releaseRunLock(env, { key: lockKey, owner: runId });
    }
    return {
      ok: true,
      skipped: true,
      reason: "run_already_exists",
      runId,
      collectionDate
    };
  }
  try {
    log2.info("pipeline", `Daily run ${runId} starting: collecting RBA rate and refreshing endpoints`, { runId });
    const rbaCollection = await collectRbaCashRateForDate(env.DB, collectionDate);
    const endpointRefresh = await refreshEndpointCache(env.DB, TARGET_LENDERS);
    const enqueue = await enqueueDailyLenderJobs(env, {
      runId,
      runSource: options.source,
      collectionDate,
      lenders: TARGET_LENDERS
    });
    const savingsEnqueue = await enqueueDailySavingsLenderJobs(env, {
      runId,
      runSource: options.source,
      collectionDate,
      lenders: TARGET_LENDERS
    });
    const summary = buildInitialPerLenderSummary(enqueue.perLender);
    await setRunEnqueuedSummary(env.DB, runId, summary);
    const totalEnqueued = enqueue.enqueued + savingsEnqueue.enqueued;
    log2.info("pipeline", `Daily run ${runId} enqueued ${totalEnqueued} jobs (${enqueue.enqueued} loan + ${savingsEnqueue.enqueued} savings/td) for ${collectionDate}`, { runId });
    if (lockAcquired) {
      await releaseRunLock(env, { key: lockKey, owner: runId });
    }
    return {
      ok: true,
      skipped: false,
      runId,
      collectionDate,
      enqueued: totalEnqueued,
      endpoint_refresh: endpointRefresh,
      rba_collection: rbaCollection,
      source: options.source
    };
  } catch (error) {
    log2.error("pipeline", `Daily run ${runId} failed: ${error?.message || String(error)}`, { runId });
    await markRunFailed(env.DB, runId, `daily_run_enqueue_failed: ${error?.message || String(error)}`);
    throw error;
  }
}
__name(triggerDailyRun, "triggerDailyRun");
async function triggerBackfillRun(env, input) {
  const melbourneParts = getMelbourneNowParts(/* @__PURE__ */ new Date(), env.MELBOURNE_TIMEZONE || MELBOURNE_TIMEZONE);
  const monthCursor = isMonthCursor(input.monthCursor) ? input.monthCursor : currentMonthCursor(melbourneParts);
  const maxSnapshotsPerMonth = Math.min(3, Math.max(1, Number(input.maxSnapshotsPerMonth) || 3));
  const lenders = filterLenders(input.lenderCodes);
  const runId = buildBackfillRunId(monthCursor);
  await createRunReport(env.DB, {
    runId,
    runType: "backfill",
    runSource: "manual"
  });
  const jobs = [];
  for (const lender of lenders) {
    for (const seedUrl of lender.seed_rate_urls.slice(0, maxSnapshotsPerMonth)) {
      jobs.push({
        lenderCode: lender.code,
        seedUrl,
        monthCursor
      });
    }
  }
  try {
    log2.info("pipeline", `Backfill run ${runId} starting for month=${monthCursor} lenders=${lenders.length}`, { runId });
    const enqueue = await enqueueBackfillJobs(env, {
      runId,
      runSource: "manual",
      jobs
    });
    await setRunEnqueuedSummary(env.DB, runId, buildInitialPerLenderSummary(enqueue.perLender));
    log2.info("pipeline", `Backfill run ${runId} enqueued ${enqueue.enqueued} jobs`, { runId });
    return {
      ok: true,
      runId,
      monthCursor,
      selectedLenders: lenders.map((l) => l.code),
      maxSnapshotsPerMonth,
      enqueued: enqueue.enqueued
    };
  } catch (error) {
    log2.error("pipeline", `Backfill run ${runId} failed: ${error?.message || String(error)}`, { runId });
    await markRunFailed(env.DB, runId, `backfill_enqueue_failed: ${error?.message || String(error)}`);
    throw error;
  }
}
__name(triggerBackfillRun, "triggerBackfillRun");

// src/pipeline/scheduled.ts
var RATE_CHECK_INTERVAL_KEY = "rate_check_interval_minutes";
var RATE_CHECK_LAST_RUN_KEY = "rate_check_last_run_iso";
var DEFAULT_INTERVAL_MINUTES = 1;
async function handleScheduledDaily(_event, env) {
  const melbourneParts = getMelbourneNowParts(/* @__PURE__ */ new Date(), env.MELBOURNE_TIMEZONE || "Australia/Melbourne");
  const collectionDate = melbourneParts.date;
  const intervalRaw = await getAppConfig(env.DB, RATE_CHECK_INTERVAL_KEY);
  const intervalMinutes = Math.max(1, parseInt(intervalRaw ?? String(DEFAULT_INTERVAL_MINUTES), 10) || DEFAULT_INTERVAL_MINUTES);
  const lastRunIso = await getAppConfig(env.DB, RATE_CHECK_LAST_RUN_KEY);
  const now = Date.now();
  const lastRunMs = lastRunIso ? new Date(lastRunIso).getTime() : 0;
  const elapsedMinutes = (now - lastRunMs) / (60 * 1e3);
  if (lastRunIso && elapsedMinutes < intervalMinutes) {
    log2.info("scheduler", `Skipping: interval not elapsed (${Math.round(elapsedMinutes)}m < ${intervalMinutes}m)`);
    return {
      ok: true,
      skipped: true,
      reason: "interval_not_elapsed",
      elapsedMinutes: Math.round(elapsedMinutes * 10) / 10,
      intervalMinutes
    };
  }
  log2.info("scheduler", `Triggering rate check run (interval=${intervalMinutes}m, collectionDate=${collectionDate})`);
  const runIdOverride = buildScheduledRunId(collectionDate);
  const result = await triggerDailyRun(env, {
    source: "scheduled",
    runIdOverride
  });
  log2.info("scheduler", `Rate check run result`, { context: JSON.stringify(result) });
  if (result.ok && !result.skipped) {
    await setAppConfig(env.DB, RATE_CHECK_LAST_RUN_KEY, (/* @__PURE__ */ new Date()).toISOString());
  }
  return {
    ...result,
    melbourne: melbourneParts,
    intervalMinutes
  };
}
__name(handleScheduledDaily, "handleScheduledDaily");

// src/db/historical-rates.ts
async function upsertHistoricalRateRow(db, row) {
  const verdict = validateNormalizedRow(row);
  if (!verdict.ok) {
    throw new Error(`invalid_normalized_rate_row:${verdict.reason}`);
  }
  await db.prepare(
    `INSERT INTO historical_loan_rates (
        bank_name,
        collection_date,
        product_id,
        product_name,
        security_purpose,
        repayment_type,
        rate_structure,
        lvr_tier,
        feature_set,
        interest_rate,
        comparison_rate,
        annual_fee,
        source_url,
        data_quality_flag,
        confidence_score,
        parsed_at,
        run_id,
        run_source
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, CURRENT_TIMESTAMP, ?16, ?17)
      ON CONFLICT(bank_name, collection_date, product_id, lvr_tier, rate_structure, security_purpose, repayment_type, run_source) DO UPDATE SET
        product_name = excluded.product_name,
        feature_set = excluded.feature_set,
        interest_rate = excluded.interest_rate,
        comparison_rate = excluded.comparison_rate,
        annual_fee = excluded.annual_fee,
        source_url = excluded.source_url,
        data_quality_flag = excluded.data_quality_flag,
        confidence_score = excluded.confidence_score,
        parsed_at = CURRENT_TIMESTAMP,
        run_id = excluded.run_id`
  ).bind(
    row.bankName,
    row.collectionDate,
    row.productId,
    row.productName,
    row.securityPurpose,
    row.repaymentType,
    row.rateStructure,
    row.lvrTier,
    row.featureSet,
    row.interestRate,
    row.comparisonRate,
    row.annualFee,
    row.sourceUrl,
    row.dataQualityFlag,
    row.confidenceScore,
    row.runId ?? null,
    row.runSource ?? "scheduled"
  ).run();
}
__name(upsertHistoricalRateRow, "upsertHistoricalRateRow");
async function upsertHistoricalRateRows(db, rows4) {
  let written = 0;
  for (const row of rows4) {
    try {
      await upsertHistoricalRateRow(db, row);
      written += 1;
    } catch (error) {
      log2.error("db", `upsert_failed product=${row.productId} bank=${row.bankName} date=${row.collectionDate}`, {
        context: error?.message || String(error),
        lenderCode: row.bankName
      });
    }
  }
  return written;
}
__name(upsertHistoricalRateRows, "upsertHistoricalRateRows");

// src/ingest/normalize-savings.ts
var MIN_SAVINGS_RATE = 0;
var MAX_SAVINGS_RATE = 15;
function asText2(value) {
  if (value == null) return "";
  return String(value).trim();
}
__name(asText2, "asText");
function lower2(value) {
  return asText2(value).toLowerCase();
}
__name(lower2, "lower");
function normalizeAccountType(text) {
  const t = lower2(text);
  if (t.includes("transaction") || t.includes("everyday") || t.includes("spending")) return "transaction";
  if (t.includes("at call") || t.includes("at_call")) return "at_call";
  return "savings";
}
__name(normalizeAccountType, "normalizeAccountType");
function normalizeDepositRateType(depositRateType) {
  const t = lower2(depositRateType);
  if (t.includes("bonus")) return "bonus";
  if (t.includes("introductory") || t.includes("intro")) return "introductory";
  if (t.includes("bundle") || t.includes("bundled")) return "bundle";
  if (t === "fixed" || t === "variable" || t === "floating" || t === "market_linked") return "base";
  return "base";
}
__name(normalizeDepositRateType, "normalizeDepositRateType");
function normalizeDepositTier(minBalance, maxBalance) {
  if (minBalance == null && maxBalance == null) return "all";
  const fmt = /* @__PURE__ */ __name((n) => {
    if (n >= 1e6) return `$${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}m`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(n % 1e3 === 0 ? 0 : 1)}k`;
    return `$${n}`;
  }, "fmt");
  if (minBalance != null && maxBalance != null) return `${fmt(minBalance)}-${fmt(maxBalance)}`;
  if (minBalance != null) return `${fmt(minBalance)}+`;
  if (maxBalance != null) return `up to ${fmt(maxBalance)}`;
  return "all";
}
__name(normalizeDepositTier, "normalizeDepositTier");
function parseTermMonths(duration) {
  const t = asText2(duration).toUpperCase();
  const isoMatch = t.match(/^P(\d+)([DMYW])$/);
  if (isoMatch) {
    const n2 = Number(isoMatch[1]);
    const unit = isoMatch[2];
    if (unit === "M") return n2;
    if (unit === "D") return Math.round(n2 / 30);
    if (unit === "Y" || unit === "W") return unit === "Y" ? n2 * 12 : Math.round(n2 * 7 / 30);
  }
  const monthMatch = t.match(/(\d+)\s*(?:month|mth|mo)/i);
  if (monthMatch) return Number(monthMatch[1]);
  const dayMatch = t.match(/(\d+)\s*day/i);
  if (dayMatch) return Math.round(Number(dayMatch[1]) / 30);
  const yearMatch = t.match(/(\d+)\s*year/i);
  if (yearMatch) return Number(yearMatch[1]) * 12;
  const n = Number(t);
  if (Number.isFinite(n) && n > 0 && n <= 120) return n;
  return null;
}
__name(parseTermMonths, "parseTermMonths");
function normalizeInterestPayment(text) {
  const t = lower2(text);
  if (t.includes("monthly")) return "monthly";
  if (t.includes("quarterly") || t.includes("quarter")) return "quarterly";
  if (t.includes("annual") || t.includes("yearly")) return "annually";
  return "at_maturity";
}
__name(normalizeInterestPayment, "normalizeInterestPayment");
function parseSavingsInterestRate(value) {
  if (value == null || value === "") return null;
  let n;
  if (typeof value === "number") {
    n = value;
  } else {
    const text = String(value);
    const matches = text.match(/-?\d+(?:\.\d+)?/g) ?? [];
    if (matches.length !== 1) return null;
    n = Number(matches[0]);
  }
  if (!Number.isFinite(n)) return null;
  if (n > 0 && n < 1) n = Number((n * 100).toFixed(4));
  if (n < MIN_SAVINGS_RATE || n > MAX_SAVINGS_RATE) return null;
  return n;
}
__name(parseSavingsInterestRate, "parseSavingsInterestRate");
function validateNormalizedSavingsRow(row) {
  if (!row.productId?.trim()) return { ok: false, reason: "missing_product_id" };
  if (!row.productName?.trim()) return { ok: false, reason: "missing_product_name" };
  if (!row.sourceUrl?.trim()) return { ok: false, reason: "missing_source_url" };
  if (!Number.isFinite(row.interestRate) || row.interestRate < MIN_SAVINGS_RATE || row.interestRate > MAX_SAVINGS_RATE) {
    return { ok: false, reason: "interest_rate_out_of_bounds" };
  }
  if (!Number.isFinite(row.confidenceScore) || row.confidenceScore < 0 || row.confidenceScore > 1) {
    return { ok: false, reason: "confidence_out_of_bounds" };
  }
  return { ok: true };
}
__name(validateNormalizedSavingsRow, "validateNormalizedSavingsRow");
function validateNormalizedTdRow(row) {
  if (!row.productId?.trim()) return { ok: false, reason: "missing_product_id" };
  if (!row.productName?.trim()) return { ok: false, reason: "missing_product_name" };
  if (!row.sourceUrl?.trim()) return { ok: false, reason: "missing_source_url" };
  if (!Number.isFinite(row.interestRate) || row.interestRate < MIN_SAVINGS_RATE || row.interestRate > MAX_SAVINGS_RATE) {
    return { ok: false, reason: "interest_rate_out_of_bounds" };
  }
  if (!Number.isFinite(row.termMonths) || row.termMonths < 1 || row.termMonths > 120) {
    return { ok: false, reason: "term_months_out_of_bounds" };
  }
  if (!Number.isFinite(row.confidenceScore) || row.confidenceScore < 0 || row.confidenceScore > 1) {
    return { ok: false, reason: "confidence_out_of_bounds" };
  }
  return { ok: true };
}
__name(validateNormalizedTdRow, "validateNormalizedTdRow");

// src/db/savings-rates.ts
async function upsertSavingsRateRow(db, row) {
  const verdict = validateNormalizedSavingsRow(row);
  if (!verdict.ok) {
    throw new Error(`invalid_savings_row:${verdict.reason}`);
  }
  await db.prepare(
    `INSERT INTO historical_savings_rates (
        bank_name, collection_date, product_id, product_name,
        account_type, rate_type, interest_rate, deposit_tier,
        min_balance, max_balance, conditions, monthly_fee,
        source_url, data_quality_flag, confidence_score,
        parsed_at, run_id, run_source
      ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,CURRENT_TIMESTAMP,?16,?17)
      ON CONFLICT(bank_name, collection_date, product_id, rate_type, deposit_tier, run_source) DO UPDATE SET
        product_name = excluded.product_name,
        account_type = excluded.account_type,
        interest_rate = excluded.interest_rate,
        min_balance = excluded.min_balance,
        max_balance = excluded.max_balance,
        conditions = excluded.conditions,
        monthly_fee = excluded.monthly_fee,
        source_url = excluded.source_url,
        data_quality_flag = excluded.data_quality_flag,
        confidence_score = excluded.confidence_score,
        parsed_at = CURRENT_TIMESTAMP,
        run_id = excluded.run_id`
  ).bind(
    row.bankName,
    row.collectionDate,
    row.productId,
    row.productName,
    row.accountType,
    row.rateType,
    row.interestRate,
    row.depositTier,
    row.minBalance,
    row.maxBalance,
    row.conditions,
    row.monthlyFee,
    row.sourceUrl,
    row.dataQualityFlag,
    row.confidenceScore,
    row.runId ?? null,
    row.runSource ?? "scheduled"
  ).run();
}
__name(upsertSavingsRateRow, "upsertSavingsRateRow");
async function upsertSavingsRateRows(db, rows4) {
  let written = 0;
  for (const row of rows4) {
    try {
      await upsertSavingsRateRow(db, row);
      written += 1;
    } catch (error) {
      log2.error("db", `savings_upsert_failed product=${row.productId} bank=${row.bankName}`, {
        context: error?.message || String(error),
        lenderCode: row.bankName
      });
    }
  }
  return written;
}
__name(upsertSavingsRateRows, "upsertSavingsRateRows");

// src/db/td-rates.ts
async function upsertTdRateRow(db, row) {
  const verdict = validateNormalizedTdRow(row);
  if (!verdict.ok) {
    throw new Error(`invalid_td_row:${verdict.reason}`);
  }
  await db.prepare(
    `INSERT INTO historical_term_deposit_rates (
        bank_name, collection_date, product_id, product_name,
        term_months, interest_rate, deposit_tier,
        min_deposit, max_deposit, interest_payment,
        source_url, data_quality_flag, confidence_score,
        parsed_at, run_id, run_source
      ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,CURRENT_TIMESTAMP,?14,?15)
      ON CONFLICT(bank_name, collection_date, product_id, term_months, deposit_tier, run_source) DO UPDATE SET
        product_name = excluded.product_name,
        interest_rate = excluded.interest_rate,
        min_deposit = excluded.min_deposit,
        max_deposit = excluded.max_deposit,
        interest_payment = excluded.interest_payment,
        source_url = excluded.source_url,
        data_quality_flag = excluded.data_quality_flag,
        confidence_score = excluded.confidence_score,
        parsed_at = CURRENT_TIMESTAMP,
        run_id = excluded.run_id`
  ).bind(
    row.bankName,
    row.collectionDate,
    row.productId,
    row.productName,
    row.termMonths,
    row.interestRate,
    row.depositTier,
    row.minDeposit,
    row.maxDeposit,
    row.interestPayment,
    row.sourceUrl,
    row.dataQualityFlag,
    row.confidenceScore,
    row.runId ?? null,
    row.runSource ?? "scheduled"
  ).run();
}
__name(upsertTdRateRow, "upsertTdRateRow");
async function upsertTdRateRows(db, rows4) {
  let written = 0;
  for (const row of rows4) {
    try {
      await upsertTdRateRow(db, row);
      written += 1;
    } catch (error) {
      log2.error("db", `td_upsert_failed product=${row.productId} bank=${row.bankName}`, {
        context: error?.message || String(error),
        lenderCode: row.bankName
      });
    }
  }
  return written;
}
__name(upsertTdRateRows, "upsertTdRateRows");

// src/utils/hash.ts
function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(toHex, "toHex");
async function sha256HexFromBytes(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const input = new Uint8Array(source.byteLength);
  input.set(source);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return toHex(digest);
}
__name(sha256HexFromBytes, "sha256HexFromBytes");

// src/db/raw-payloads.ts
function contentTypeForSource(sourceType) {
  return sourceType === "wayback_html" ? "text/html; charset=utf-8" : "application/json; charset=utf-8";
}
__name(contentTypeForSource, "contentTypeForSource");
function serializePayload(payload) {
  if (typeof payload === "string") {
    return payload;
  }
  if (payload instanceof Uint8Array) {
    return new TextDecoder().decode(payload);
  }
  if (payload instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(payload));
  }
  try {
    return JSON.stringify(payload ?? null, null, 2);
  } catch {
    return JSON.stringify({ fallback: String(payload) });
  }
}
__name(serializePayload, "serializePayload");
async function persistRawPayload(env, input) {
  const fetchedAtIso = input.fetchedAtIso || nowIso();
  const payloadText = serializePayload(input.payload);
  const payloadBytes = new TextEncoder().encode(payloadText);
  const contentHash = await sha256HexFromBytes(payloadBytes);
  const existing = await env.DB.prepare(
    `SELECT id, r2_key
     FROM raw_payloads
     WHERE source_type = ?1
       AND source_url = ?2
       AND content_hash = ?3
     LIMIT 1`
  ).bind(input.sourceType, input.sourceUrl, contentHash).first();
  if (existing) {
    return {
      inserted: false,
      id: Number(existing.id),
      contentHash,
      r2Key: existing.r2_key
    };
  }
  const r2Key = buildRawR2Key(input.sourceType, fetchedAtIso, contentHash);
  await env.RAW_BUCKET.put(r2Key, payloadText, {
    httpMetadata: {
      contentType: contentTypeForSource(input.sourceType)
    },
    customMetadata: {
      source_type: input.sourceType,
      source_url: input.sourceUrl,
      content_hash: contentHash
    }
  });
  const inserted = await env.DB.prepare(
    `INSERT INTO raw_payloads (
      source_type,
      fetched_at,
      source_url,
      content_hash,
      r2_key,
      http_status,
      notes
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  ).bind(
    input.sourceType,
    fetchedAtIso,
    input.sourceUrl,
    contentHash,
    r2Key,
    input.httpStatus == null ? null : Math.floor(input.httpStatus),
    input.notes ?? null
  ).run();
  return {
    inserted: Number(inserted.meta?.changes || 0) > 0,
    id: Number(inserted.meta?.last_row_id || 0) || null,
    contentHash,
    r2Key
  };
}
__name(persistRawPayload, "persistRawPayload");

// src/ingest/cdr-savings.ts
function isSavingsAccount(product) {
  const category = pickText(product, ["productCategory", "category", "type"]).toUpperCase();
  const name = pickText(product, ["name", "productName"]).toUpperCase();
  if (category.includes("TRANS_AND_SAVINGS") || category.includes("SAVINGS")) return true;
  if (name.includes("SAVINGS") || name.includes("SAVER") || name.includes("AT CALL")) return true;
  return false;
}
__name(isSavingsAccount, "isSavingsAccount");
function isTermDeposit(product) {
  const category = pickText(product, ["productCategory", "category", "type"]).toUpperCase();
  const name = pickText(product, ["name", "productName"]).toUpperCase();
  if (category.includes("TERM_DEPOSIT")) return true;
  if (name.includes("TERM DEPOSIT") || name.includes("FIXED DEPOSIT")) return true;
  return false;
}
__name(isTermDeposit, "isTermDeposit");
function extractDepositRatesArray(detail) {
  const arrays = [detail.depositRates, detail.rates, detail.rateTiers, detail.rate];
  for (const candidate of arrays) {
    const arr = asArray(candidate).filter(isRecord);
    if (arr.length > 0) return arr;
  }
  return [];
}
__name(extractDepositRatesArray, "extractDepositRatesArray");
function parseTierBounds(rate) {
  const tiers = asArray(rate.tiers).filter(isRecord);
  for (const tier of tiers) {
    const unitOfMeasure = getText(tier.unitOfMeasure).toUpperCase();
    if (unitOfMeasure && unitOfMeasure !== "DOLLAR" && unitOfMeasure !== "AMOUNT") continue;
    const min = Number.isFinite(Number(tier.minimumValue)) ? Number(tier.minimumValue) : null;
    const max = Number.isFinite(Number(tier.maximumValue)) ? Number(tier.maximumValue) : null;
    if (min != null || max != null) return { min, max };
  }
  return { min: null, max: null };
}
__name(parseTierBounds, "parseTierBounds");
function collectConditionsText(rate, detail) {
  const parts = [];
  const info = getText(rate.additionalInfo);
  if (info) parts.push(info);
  const value = getText(rate.additionalValue);
  if (value && !value.match(/^P\d+[DMYW]$/)) parts.push(value);
  const desc = getText(detail.description);
  if (desc && desc.length < 300) parts.push(desc);
  return parts.filter(Boolean).join(" | ");
}
__name(collectConditionsText, "collectConditionsText");
function parseMonthlyFeeFromDetail(detail) {
  const fees = asArray(detail.fees).filter(isRecord);
  for (const fee of fees) {
    const feeType = pickText(fee, ["feeType", "name"]).toLowerCase();
    if (!feeType.includes("monthly") && !feeType.includes("service")) continue;
    const amount = Number(fee.amount ?? fee.additionalValue);
    if (Number.isFinite(amount) && amount >= 0 && amount <= 50) return amount;
  }
  return null;
}
__name(parseMonthlyFeeFromDetail, "parseMonthlyFeeFromDetail");
function parseSavingsRatesFromDetail(input) {
  const { detail, lender, sourceUrl, collectionDate } = input;
  const productId = pickText(detail, ["productId", "id"]);
  const productName = normalizeProductName(pickText(detail, ["name", "productName"]));
  if (!productId || !productName) return [];
  const rates = extractDepositRatesArray(detail);
  if (rates.length === 0) return [];
  const monthlyFee = parseMonthlyFeeFromDetail(detail);
  const result = [];
  const accountType = normalizeAccountType(`${productName} ${pickText(detail, ["description", "productCategory"])}`);
  for (const rate of rates) {
    const depositRateType = getText(rate.depositRateType || rate.rateType || rate.type);
    const rateType = normalizeDepositRateType(depositRateType);
    const interestRate = parseSavingsInterestRate(rate.rate ?? rate.interestRate ?? rate.value);
    if (interestRate == null) continue;
    const bounds = parseTierBounds(rate);
    const depositTier = normalizeDepositTier(bounds.min, bounds.max);
    const conditions = collectConditionsText(rate, detail);
    let confidence = 0.93;
    if (!conditions) confidence -= 0.03;
    result.push({
      bankName: normalizeBankName(lender.canonical_bank_name, lender.name),
      collectionDate,
      productId,
      productName,
      accountType,
      rateType,
      interestRate,
      depositTier,
      minBalance: bounds.min,
      maxBalance: bounds.max,
      conditions: conditions || null,
      monthlyFee,
      sourceUrl,
      dataQualityFlag: "cdr_live",
      confidenceScore: Number(Math.max(0.6, Math.min(0.99, confidence)).toFixed(3))
    });
  }
  return result;
}
__name(parseSavingsRatesFromDetail, "parseSavingsRatesFromDetail");
function parseTermDepositRatesFromDetail(input) {
  const { detail, lender, sourceUrl, collectionDate } = input;
  const productId = pickText(detail, ["productId", "id"]);
  const productName = normalizeProductName(pickText(detail, ["name", "productName"]));
  if (!productId || !productName) return [];
  const rates = extractDepositRatesArray(detail);
  if (rates.length === 0) return [];
  const result = [];
  for (const rate of rates) {
    const interestRate = parseSavingsInterestRate(rate.rate ?? rate.interestRate ?? rate.value);
    if (interestRate == null) continue;
    const additionalValue = getText(rate.additionalValue);
    const termMonths = parseTermMonths(additionalValue) ?? parseTermMonths(getText(rate.name)) ?? parseTermMonths(productName);
    if (termMonths == null || termMonths < 1) continue;
    const bounds = parseTierBounds(rate);
    const depositTier = normalizeDepositTier(bounds.min, bounds.max);
    const paymentText = `${getText(rate.applicationFrequency)} ${getText(rate.additionalInfo)}`;
    const interestPayment = normalizeInterestPayment(paymentText);
    let confidence = 0.93;
    if (!additionalValue) confidence -= 0.03;
    result.push({
      bankName: normalizeBankName(lender.canonical_bank_name, lender.name),
      collectionDate,
      productId,
      productName,
      termMonths,
      interestRate,
      depositTier,
      minDeposit: bounds.min,
      maxDeposit: bounds.max,
      interestPayment,
      sourceUrl,
      dataQualityFlag: "cdr_live",
      confidenceScore: Number(Math.max(0.6, Math.min(0.99, confidence)).toFixed(3))
    });
  }
  return result;
}
__name(parseTermDepositRatesFromDetail, "parseTermDepositRatesFromDetail");
async function fetchSavingsProductIds(endpointUrl, pageLimit = 20, options) {
  const ids = /* @__PURE__ */ new Set();
  const payloads = [];
  let url = endpointUrl;
  let pages = 0;
  const versions = options?.cdrVersions?.length ? options.cdrVersions : [6, 5, 4, 3];
  while (url && pages < pageLimit) {
    pages += 1;
    const response = await fetchCdrJson(url, versions);
    payloads.push({ sourceUrl: url, status: response.status, body: response.text });
    if (!response.ok || !response.data) break;
    const products = extractProducts(response.data);
    for (const product of products) {
      if (!isSavingsAccount(product)) continue;
      const id = pickText(product, ["productId", "id"]);
      if (id) ids.add(id);
    }
    url = nextLink(response.data);
  }
  return { productIds: Array.from(ids), rawPayloads: payloads };
}
__name(fetchSavingsProductIds, "fetchSavingsProductIds");
async function fetchTermDepositProductIds(endpointUrl, pageLimit = 20, options) {
  const ids = /* @__PURE__ */ new Set();
  const payloads = [];
  let url = endpointUrl;
  let pages = 0;
  const versions = options?.cdrVersions?.length ? options.cdrVersions : [6, 5, 4, 3];
  while (url && pages < pageLimit) {
    pages += 1;
    const response = await fetchCdrJson(url, versions);
    payloads.push({ sourceUrl: url, status: response.status, body: response.text });
    if (!response.ok || !response.data) break;
    const products = extractProducts(response.data);
    for (const product of products) {
      if (!isTermDeposit(product)) continue;
      const id = pickText(product, ["productId", "id"]);
      if (id) ids.add(id);
    }
    url = nextLink(response.data);
  }
  return { productIds: Array.from(ids), rawPayloads: payloads };
}
__name(fetchTermDepositProductIds, "fetchTermDepositProductIds");
async function fetchSavingsProductDetailRows(input) {
  const detailUrl = `${input.endpointUrl.replace(/\/+$/, "")}/${encodeURIComponent(input.productId)}`;
  const versions = input.cdrVersions?.length ? input.cdrVersions : [6, 5, 4, 3];
  const fetched = await fetchCdrJson(detailUrl, versions);
  const rawPayload = { sourceUrl: detailUrl, status: fetched.status, body: fetched.text };
  if (!fetched.ok || !isRecord(fetched.data)) return { savingsRows: [], rawPayload };
  const detail = isRecord(fetched.data.data) ? fetched.data.data : fetched.data;
  return {
    savingsRows: parseSavingsRatesFromDetail({
      lender: input.lender,
      detail,
      sourceUrl: detailUrl,
      collectionDate: input.collectionDate
    }),
    rawPayload
  };
}
__name(fetchSavingsProductDetailRows, "fetchSavingsProductDetailRows");
async function fetchTdProductDetailRows(input) {
  const detailUrl = `${input.endpointUrl.replace(/\/+$/, "")}/${encodeURIComponent(input.productId)}`;
  const versions = input.cdrVersions?.length ? input.cdrVersions : [6, 5, 4, 3];
  const fetched = await fetchCdrJson(detailUrl, versions);
  const rawPayload = { sourceUrl: detailUrl, status: fetched.status, body: fetched.text };
  if (!fetched.ok || !isRecord(fetched.data)) return { tdRows: [], rawPayload };
  const detail = isRecord(fetched.data.data) ? fetched.data.data : fetched.data;
  return {
    tdRows: parseTermDepositRatesFromDetail({
      lender: input.lender,
      detail,
      sourceUrl: detailUrl,
      collectionDate: input.collectionDate
    }),
    rawPayload
  };
}
__name(fetchTdProductDetailRows, "fetchTdProductDetailRows");

// src/ingest/html-rate-parser.ts
function hashString(input) {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = Math.imul(31, h) + input.charCodeAt(i) | 0;
  }
  return h;
}
__name(hashString, "hashString");
function cleanHtmlToLines(html) {
  const marked = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<(tr|li|p|br|div|td|th|h[1-6])\b[^>]*>/gi, "\n").replace(/<\/(tr|li|p|div|td|th|h[1-6])>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\u00a0/g, " ");
  return marked.split(/\n+/).map((line) => line.replace(/\s+/g, " ").trim()).filter((line) => line.length >= 4);
}
__name(cleanHtmlToLines, "cleanHtmlToLines");
function parseRatesFromText(text) {
  const numericTokens = Array.from(text.matchAll(/\b(\d{1,2}(?:\.\d{1,3})?)\s*%/g)).map((m) => m[1]);
  const parsed = numericTokens.map((token) => parseInterestRate(`${token}%`)).filter((x) => x != null);
  if (parsed.length === 0) {
    return { rates: [], comparisonRate: null };
  }
  const hasComparisonLabel = /comparison\s+rate/i.test(text);
  const comparisonRate = hasComparisonLabel && parsed.length > 1 ? parseComparisonRate(`${parsed[1]}%`) : null;
  return {
    rates: [parsed[0]],
    comparisonRate
  };
}
__name(parseRatesFromText, "parseRatesFromText");
function isExcluded(text, excludes) {
  const t = text.toLowerCase();
  return excludes.some((x) => t.includes(x));
}
__name(isExcluded, "isExcluded");
function hasIncludeSignal(text, includes) {
  const t = text.toLowerCase();
  if (includes.some((x) => t.includes(x))) return true;
  return t.includes("rate");
}
__name(hasIncludeSignal, "hasIncludeSignal");
function buildProductName(currentLine, previousLine) {
  const stripped = currentLine.replace(/\b\d{1,2}(?:\.\d{1,3})?\s*%/g, " ").replace(/comparison\s+rate/gi, " ").replace(/\s+/g, " ").trim();
  const primary = normalizeProductName(stripped);
  if (isProductNameLikelyRateProduct(primary)) {
    return primary;
  }
  return normalizeProductName(`${previousLine} ${primary}`);
}
__name(buildProductName, "buildProductName");
function extractLenderRatesFromHtml(input) {
  const playbook = getLenderPlaybook(input.lender);
  const lines = cleanHtmlToLines(input.html);
  const rows4 = [];
  const seen = /* @__PURE__ */ new Set();
  let dropped = 0;
  let inspected = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const previous = i > 0 ? lines[i - 1] : "";
    const current = lines[i];
    const context = `${previous} ${current}`.trim();
    if (!hasIncludeSignal(context, playbook.includeKeywords)) continue;
    if (isExcluded(context, playbook.excludeKeywords)) continue;
    inspected += 1;
    const parsed = parseRatesFromText(context);
    if (parsed.rates.length === 0) {
      dropped += 1;
      continue;
    }
    const interestRate = parsed.rates[0];
    if (interestRate < playbook.minRatePercent || interestRate > playbook.maxRatePercent) {
      dropped += 1;
      continue;
    }
    const productName = buildProductName(current, previous);
    if (!isProductNameLikelyRateProduct(productName)) {
      dropped += 1;
      continue;
    }
    let confidence = input.mode === "daily" ? 0.94 : 0.86;
    if (!/rate/i.test(context)) confidence -= 0.05;
    if (/comparison\s+rate/i.test(context)) confidence += 0.01;
    if (!playbook.includeKeywords.some((x) => context.toLowerCase().includes(x))) confidence -= 0.08;
    const minConfidence = input.mode === "daily" ? playbook.dailyMinConfidence : playbook.historicalMinConfidence;
    if (confidence < minConfidence) {
      dropped += 1;
      continue;
    }
    const securityPurpose = normalizeSecurityPurpose(context);
    const repaymentType = normalizeRepaymentType(context);
    const rateStructure = normalizeRateStructure(context);
    const lvrResult = normalizeLvrTier(context);
    if (lvrResult.wasDefault) confidence -= 0.03;
    const featureSet = normalizeFeatureSet(productName, null);
    const productId = `${input.lender.code}-html-${Math.abs(hashString(`${productName}|${rateStructure}|${lvrResult.tier}`))}`;
    const rowKey = `${productId}|${input.collectionDate}|${interestRate}`;
    if (seen.has(rowKey)) continue;
    seen.add(rowKey);
    rows4.push({
      bankName: normalizeBankName(input.lender.canonical_bank_name, input.lender.name),
      collectionDate: input.collectionDate,
      productId,
      productName,
      securityPurpose,
      repaymentType,
      rateStructure,
      lvrTier: lvrResult.tier,
      featureSet,
      interestRate,
      comparisonRate: parsed.comparisonRate,
      annualFee: null,
      sourceUrl: input.sourceUrl,
      dataQualityFlag: input.qualityFlag,
      confidenceScore: Number(confidence.toFixed(3))
    });
  }
  return { rows: rows4, inspected, dropped };
}
__name(extractLenderRatesFromHtml, "extractLenderRatesFromHtml");

// src/queue/consumer.ts
function calculateRetryDelaySeconds(attempts) {
  const safeAttempt = Math.max(1, Math.floor(attempts));
  return Math.min(900, 15 * Math.pow(2, safeAttempt - 1));
}
__name(calculateRetryDelaySeconds, "calculateRetryDelaySeconds");
function isObject(value) {
  return !!value && typeof value === "object";
}
__name(isObject, "isObject");
function isIngestMessage(value) {
  if (!isObject(value) || typeof value.kind !== "string") {
    return false;
  }
  if (value.kind === "daily_lender_fetch") {
    return typeof value.runId === "string" && typeof value.lenderCode === "string" && typeof value.collectionDate === "string";
  }
  if (value.kind === "product_detail_fetch") {
    return typeof value.runId === "string" && typeof value.lenderCode === "string" && typeof value.productId === "string" && typeof value.collectionDate === "string";
  }
  if (value.kind === "backfill_snapshot_fetch") {
    return typeof value.runId === "string" && typeof value.lenderCode === "string" && typeof value.seedUrl === "string" && typeof value.monthCursor === "string";
  }
  if (value.kind === "daily_savings_lender_fetch") {
    return typeof value.runId === "string" && typeof value.lenderCode === "string" && typeof value.collectionDate === "string";
  }
  return false;
}
__name(isIngestMessage, "isIngestMessage");
function extractRunContext(body) {
  if (!isObject(body)) {
    return { runId: null, lenderCode: null };
  }
  const runId = typeof body.runId === "string" ? body.runId : null;
  const lenderCode = typeof body.lenderCode === "string" ? body.lenderCode : null;
  return { runId, lenderCode };
}
__name(extractRunContext, "extractRunContext");
function splitValidatedRows(rows4) {
  const accepted = [];
  const dropped = [];
  for (const row of rows4) {
    const verdict = validateNormalizedRow(row);
    if (verdict.ok) {
      accepted.push(row);
    } else {
      dropped.push({
        reason: verdict.reason,
        productId: row.productId
      });
    }
  }
  return { accepted, dropped };
}
__name(splitValidatedRows, "splitValidatedRows");
function splitValidatedSavingsRows(rows4) {
  const accepted = [];
  const dropped = [];
  for (const row of rows4) {
    const verdict = validateNormalizedSavingsRow(row);
    if (verdict.ok) accepted.push(row);
    else dropped.push({ reason: verdict.reason, productId: row.productId });
  }
  return { accepted, dropped };
}
__name(splitValidatedSavingsRows, "splitValidatedSavingsRows");
function splitValidatedTdRows(rows4) {
  const accepted = [];
  const dropped = [];
  for (const row of rows4) {
    const verdict = validateNormalizedTdRow(row);
    if (verdict.ok) accepted.push(row);
    else dropped.push({ reason: verdict.reason, productId: row.productId });
  }
  return { accepted, dropped };
}
__name(splitValidatedTdRows, "splitValidatedTdRows");
async function handleDailyLenderJob(env, job) {
  const lender = TARGET_LENDERS.find((x) => x.code === job.lenderCode);
  if (!lender) {
    throw new Error(`unknown_lender_code:${job.lenderCode}`);
  }
  log2.info("consumer", `daily_lender_fetch started`, { runId: job.runId, lenderCode: job.lenderCode });
  const playbook = getLenderPlaybook(lender);
  const endpoint = await getCachedEndpoint(env.DB, job.lenderCode);
  let sourceUrl = "";
  const endpointCandidates = [];
  if (endpoint?.endpointUrl) endpointCandidates.push(endpoint.endpointUrl);
  if (lender.products_endpoint) endpointCandidates.push(lender.products_endpoint);
  const discovered = await discoverProductsEndpoint(lender);
  if (discovered?.endpointUrl) endpointCandidates.push(discovered.endpointUrl);
  const uniqueCandidates = Array.from(new Set(endpointCandidates.filter(Boolean)));
  const collectedRows = [];
  let inspectedHtml = 0;
  let droppedByParser = 0;
  for (const candidateEndpoint of uniqueCandidates) {
    const products = await fetchResidentialMortgageProductIds(candidateEndpoint, 20, { cdrVersions: playbook.cdrVersions });
    for (const payload of products.rawPayloads) {
      await persistRawPayload(env, {
        sourceType: "cdr_products",
        sourceUrl: payload.sourceUrl,
        payload: payload.body,
        httpStatus: payload.status,
        notes: `daily_product_index lender=${job.lenderCode}`
      });
    }
    const productIds = products.productIds.slice(0, 250);
    for (const productId of productIds) {
      const details = await fetchProductDetailRows({
        lender,
        endpointUrl: candidateEndpoint,
        productId,
        collectionDate: job.collectionDate,
        cdrVersions: playbook.cdrVersions
      });
      await persistRawPayload(env, {
        sourceType: "cdr_product_detail",
        sourceUrl: details.rawPayload.sourceUrl,
        payload: details.rawPayload.body,
        httpStatus: details.rawPayload.status,
        notes: `daily_product_detail lender=${job.lenderCode} product=${productId}`
      });
      for (const row of details.rows) {
        collectedRows.push(row);
      }
    }
    if (collectedRows.length > 0) {
      sourceUrl = candidateEndpoint;
      break;
    }
  }
  if (collectedRows.length === 0) {
    for (const seedUrl of lender.seed_rate_urls.slice(0, 2)) {
      const response = await fetch(seedUrl);
      const html = await response.text();
      await persistRawPayload(env, {
        sourceType: "wayback_html",
        sourceUrl: seedUrl,
        payload: html,
        httpStatus: response.status,
        notes: `fallback_scrape lender=${job.lenderCode}`
      });
      const parsed = extractLenderRatesFromHtml({
        lender,
        html,
        sourceUrl: seedUrl,
        collectionDate: job.collectionDate,
        mode: "daily",
        qualityFlag: "scraped_fallback_strict"
      });
      inspectedHtml += parsed.inspected;
      droppedByParser += parsed.dropped;
      for (const row of parsed.rows) {
        collectedRows.push(row);
      }
    }
  }
  const { accepted, dropped } = splitValidatedRows(collectedRows);
  for (const row of accepted) {
    row.runId = job.runId;
    row.runSource = job.runSource ?? "scheduled";
  }
  if (accepted.length === 0) {
    await persistRawPayload(env, {
      sourceType: "cdr_products",
      sourceUrl: sourceUrl || `fallback://${job.lenderCode}`,
      payload: {
        lenderCode: job.lenderCode,
        runId: job.runId,
        collectionDate: job.collectionDate,
        fetchedAt: nowIso(),
        acceptedRows: 0,
        rejectedRows: dropped.length,
        inspectedHtml,
        droppedByParser
      },
      httpStatus: 422,
      notes: `daily_quality_rejected lender=${job.lenderCode}`
    });
    log2.warn("consumer", `daily_ingest_no_valid_rows`, { runId: job.runId, lenderCode: job.lenderCode });
    throw new Error(`daily_ingest_no_valid_rows:${job.lenderCode}`);
  }
  const written = await upsertHistoricalRateRows(env.DB, accepted);
  log2.info("consumer", `daily_lender_fetch completed: ${written} written, ${dropped.length} dropped`, {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context: `collected=${collectedRows.length} accepted=${accepted.length} dropped=${dropped.length}`
  });
  await persistRawPayload(env, {
    sourceType: "cdr_products",
    sourceUrl: sourceUrl || `fallback://${job.lenderCode}`,
    payload: {
      lenderCode: job.lenderCode,
      runId: job.runId,
      collectionDate: job.collectionDate,
      fetchedAt: nowIso(),
      productsRows: collectedRows.length,
      acceptedRows: accepted.length,
      rejectedRows: dropped.length,
      inspectedHtml,
      droppedByParser
    },
    httpStatus: 200,
    notes: cdrCollectionNotes(collectedRows.length, accepted.length)
  });
}
__name(handleDailyLenderJob, "handleDailyLenderJob");
async function handleProductDetailJob(env, job) {
  const endpoint = await getCachedEndpoint(env.DB, job.lenderCode);
  const lender = TARGET_LENDERS.find((x) => x.code === job.lenderCode);
  if (!endpoint || !lender) {
    log2.warn("consumer", `product_detail_fetch skipped: missing endpoint or lender`, { runId: job.runId, lenderCode: job.lenderCode });
    return;
  }
  log2.info("consumer", `product_detail_fetch started for ${job.productId}`, { runId: job.runId, lenderCode: job.lenderCode });
  const details = await fetchProductDetailRows({
    lender,
    endpointUrl: endpoint.endpointUrl,
    productId: job.productId,
    collectionDate: job.collectionDate,
    cdrVersions: getLenderPlaybook(lender).cdrVersions
  });
  await persistRawPayload(env, {
    sourceType: "cdr_product_detail",
    sourceUrl: details.rawPayload.sourceUrl,
    payload: details.rawPayload.body,
    httpStatus: details.rawPayload.status,
    notes: `direct_product_detail lender=${job.lenderCode} product=${job.productId}`
  });
  const { accepted } = splitValidatedRows(details.rows);
  for (const row of accepted) {
    row.runId = job.runId;
    row.runSource = job.runSource ?? "scheduled";
  }
  if (accepted.length > 0) {
    await upsertHistoricalRateRows(env.DB, accepted);
  }
}
__name(handleProductDetailJob, "handleProductDetailJob");
async function handleBackfillSnapshotJob(env, job) {
  const lender = TARGET_LENDERS.find((x) => x.code === job.lenderCode);
  if (!lender) {
    throw new Error(`unknown_lender_code:${job.lenderCode}`);
  }
  log2.info("consumer", `backfill_snapshot_fetch started month=${job.monthCursor}`, { runId: job.runId, lenderCode: job.lenderCode });
  const [year2, month] = job.monthCursor.split("-");
  const from = `${year2}${month}01`;
  const to = `${year2}${month}31`;
  const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(
    job.seedUrl
  )}&from=${from}&to=${to}&output=json&fl=timestamp,original,statuscode,mimetype,digest&filter=statuscode:200&collapse=digest&limit=8`;
  const cdxResponse = await fetch(cdxUrl);
  const cdxBody = await cdxResponse.text();
  await persistRawPayload(env, {
    sourceType: "wayback_html",
    sourceUrl: cdxUrl,
    payload: cdxBody,
    httpStatus: cdxResponse.status,
    notes: `wayback_cdx lender=${job.lenderCode} month=${job.monthCursor}`
  });
  const rows4 = [];
  try {
    const parsed = JSON.parse(cdxBody);
    if (Array.isArray(parsed)) {
      for (let i = 1; i < parsed.length; i += 1) {
        if (Array.isArray(parsed[i])) rows4.push(parsed[i].map((x) => String(x)));
      }
    }
  } catch {
  }
  let writtenRows = 0;
  let inspectedTotal = 0;
  let droppedTotal = 0;
  for (const entry of rows4.slice(0, 5)) {
    const timestamp = entry[0];
    const original = entry[1] || job.seedUrl;
    if (!timestamp) continue;
    const snapshotUrl = `https://web.archive.org/web/${timestamp}/${original}`;
    const snapshotResponse = await fetch(snapshotUrl);
    const html = await snapshotResponse.text();
    await persistRawPayload(env, {
      sourceType: "wayback_html",
      sourceUrl: snapshotUrl,
      payload: html,
      httpStatus: snapshotResponse.status,
      notes: `wayback_snapshot lender=${job.lenderCode}`
    });
    const collectionDate = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;
    const parsed = extractLenderRatesFromHtml({
      lender,
      html,
      sourceUrl: snapshotUrl,
      collectionDate,
      mode: "historical",
      qualityFlag: "parsed_from_wayback_strict"
    });
    inspectedTotal += parsed.inspected;
    droppedTotal += parsed.dropped;
    const { accepted, dropped } = splitValidatedRows(parsed.rows);
    for (const row of accepted) {
      row.runId = job.runId;
      row.runSource = job.runSource ?? "scheduled";
    }
    droppedTotal += dropped.length;
    if (accepted.length > 0) {
      writtenRows += await upsertHistoricalRateRows(env.DB, accepted);
    }
  }
  await persistRawPayload(env, {
    sourceType: "wayback_html",
    sourceUrl: job.seedUrl,
    payload: {
      runId: job.runId,
      lenderCode: job.lenderCode,
      monthCursor: job.monthCursor,
      writtenRows,
      inspectedTotal,
      droppedTotal,
      capturedAt: nowIso()
    },
    httpStatus: 200,
    notes: `wayback_backfill_summary lender=${job.lenderCode} month=${job.monthCursor}`
  });
  const cursorKey = buildBackfillCursorKey(job.lenderCode, job.monthCursor, job.seedUrl);
  await env.DB.prepare(
    `INSERT INTO backfill_cursors (
      cursor_key,
      run_id,
      lender_code,
      seed_url,
      month_cursor,
      last_snapshot_at,
      updated_at,
      status
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    ON CONFLICT(cursor_key) DO UPDATE SET
      run_id = excluded.run_id,
      lender_code = excluded.lender_code,
      seed_url = excluded.seed_url,
      month_cursor = excluded.month_cursor,
      last_snapshot_at = excluded.last_snapshot_at,
      updated_at = excluded.updated_at,
      status = excluded.status`
  ).bind(
    cursorKey,
    job.runId,
    job.lenderCode,
    job.seedUrl,
    job.monthCursor,
    nowIso(),
    nowIso(),
    writtenRows > 0 ? "completed" : inspectedTotal > 0 ? "quality_rejected" : "empty"
  ).run();
}
__name(handleBackfillSnapshotJob, "handleBackfillSnapshotJob");
async function handleDailySavingsLenderJob(env, job) {
  const lender = TARGET_LENDERS.find((x) => x.code === job.lenderCode);
  if (!lender) throw new Error(`unknown_lender_code:${job.lenderCode}`);
  log2.info("consumer", `daily_savings_lender_fetch started`, { runId: job.runId, lenderCode: job.lenderCode });
  const playbook = getLenderPlaybook(lender);
  const endpoint = await getCachedEndpoint(env.DB, job.lenderCode);
  const endpointCandidates = [];
  if (endpoint?.endpointUrl) endpointCandidates.push(endpoint.endpointUrl);
  if (lender.products_endpoint) endpointCandidates.push(lender.products_endpoint);
  const discovered = await discoverProductsEndpoint(lender);
  if (discovered?.endpointUrl) endpointCandidates.push(discovered.endpointUrl);
  const uniqueCandidates = Array.from(new Set(endpointCandidates.filter(Boolean)));
  const savingsRows = [];
  const tdRows = [];
  for (const candidateEndpoint of uniqueCandidates) {
    const [savingsProducts, tdProducts] = await Promise.all([
      fetchSavingsProductIds(candidateEndpoint, 20, { cdrVersions: playbook.cdrVersions }),
      fetchTermDepositProductIds(candidateEndpoint, 20, { cdrVersions: playbook.cdrVersions })
    ]);
    for (const payload of [...savingsProducts.rawPayloads, ...tdProducts.rawPayloads]) {
      await persistRawPayload(env, {
        sourceType: "cdr_products",
        sourceUrl: payload.sourceUrl,
        payload: payload.body,
        httpStatus: payload.status,
        notes: `savings_td_product_index lender=${job.lenderCode}`
      });
    }
    for (const productId of savingsProducts.productIds.slice(0, 250)) {
      const details = await fetchSavingsProductDetailRows({
        lender,
        endpointUrl: candidateEndpoint,
        productId,
        collectionDate: job.collectionDate,
        cdrVersions: playbook.cdrVersions
      });
      await persistRawPayload(env, {
        sourceType: "cdr_product_detail",
        sourceUrl: details.rawPayload.sourceUrl,
        payload: details.rawPayload.body,
        httpStatus: details.rawPayload.status,
        notes: `savings_product_detail lender=${job.lenderCode} product=${productId}`
      });
      for (const row of details.savingsRows) savingsRows.push(row);
    }
    for (const productId of tdProducts.productIds.slice(0, 250)) {
      const details = await fetchTdProductDetailRows({
        lender,
        endpointUrl: candidateEndpoint,
        productId,
        collectionDate: job.collectionDate,
        cdrVersions: playbook.cdrVersions
      });
      await persistRawPayload(env, {
        sourceType: "cdr_product_detail",
        sourceUrl: details.rawPayload.sourceUrl,
        payload: details.rawPayload.body,
        httpStatus: details.rawPayload.status,
        notes: `td_product_detail lender=${job.lenderCode} product=${productId}`
      });
      for (const row of details.tdRows) tdRows.push(row);
    }
    if (savingsRows.length > 0 || tdRows.length > 0) break;
  }
  const { accepted: savingsAccepted } = splitValidatedSavingsRows(savingsRows);
  for (const row of savingsAccepted) {
    row.runId = job.runId;
    row.runSource = job.runSource ?? "scheduled";
  }
  if (savingsAccepted.length > 0) {
    const written = await upsertSavingsRateRows(env.DB, savingsAccepted);
    log2.info("consumer", `savings_lender_fetch: ${written} savings rows written`, {
      runId: job.runId,
      lenderCode: job.lenderCode
    });
  }
  const { accepted: tdAccepted } = splitValidatedTdRows(tdRows);
  for (const row of tdAccepted) {
    row.runId = job.runId;
    row.runSource = job.runSource ?? "scheduled";
  }
  if (tdAccepted.length > 0) {
    const written = await upsertTdRateRows(env.DB, tdAccepted);
    log2.info("consumer", `savings_lender_fetch: ${written} td rows written`, {
      runId: job.runId,
      lenderCode: job.lenderCode
    });
  }
  log2.info("consumer", `daily_savings_lender_fetch completed`, {
    runId: job.runId,
    lenderCode: job.lenderCode,
    context: `savings=${savingsAccepted.length} td=${tdAccepted.length}`
  });
}
__name(handleDailySavingsLenderJob, "handleDailySavingsLenderJob");
async function processMessage(env, message2) {
  if (message2.kind === "daily_lender_fetch") {
    return handleDailyLenderJob(env, message2);
  }
  if (message2.kind === "product_detail_fetch") {
    return handleProductDetailJob(env, message2);
  }
  if (message2.kind === "backfill_snapshot_fetch") {
    return handleBackfillSnapshotJob(env, message2);
  }
  if (message2.kind === "daily_savings_lender_fetch") {
    return handleDailySavingsLenderJob(env, message2);
  }
  throw new Error(`Unsupported message kind: ${String(message2.kind)}`);
}
__name(processMessage, "processMessage");
async function consumeIngestQueue(batch, env) {
  const maxAttempts = parseIntegerEnv(env.MAX_QUEUE_ATTEMPTS, DEFAULT_MAX_QUEUE_ATTEMPTS);
  log2.info("consumer", `queue_batch received ${batch.messages.length} messages`);
  for (const msg of batch.messages) {
    const attempts = Number(msg.attempts || 1);
    const body = msg.body;
    const context = extractRunContext(body);
    try {
      if (!isIngestMessage(body)) {
        log2.error("consumer", "invalid_queue_message_shape", { context: JSON.stringify(body) });
        throw new Error("invalid_queue_message_shape");
      }
      await processMessage(env, body);
      if (context.runId && context.lenderCode) {
        await recordRunQueueOutcome(env.DB, {
          runId: context.runId,
          lenderCode: context.lenderCode,
          success: true
        });
      }
      msg.ack();
    } catch (error) {
      const errorMessage = error?.message || String(error);
      log2.error("consumer", `queue_message_failed attempt=${attempts}/${maxAttempts}: ${errorMessage}`, {
        runId: context.runId ?? void 0,
        lenderCode: context.lenderCode ?? void 0
      });
      if (attempts >= maxAttempts) {
        log2.error("consumer", `queue_message_exhausted max_attempts=${maxAttempts}`, {
          runId: context.runId ?? void 0,
          lenderCode: context.lenderCode ?? void 0,
          context: errorMessage
        });
        if (context.runId && context.lenderCode) {
          await recordRunQueueOutcome(env.DB, {
            runId: context.runId,
            lenderCode: context.lenderCode,
            success: false,
            errorMessage
          });
        }
        msg.ack();
        continue;
      }
      msg.retry({
        delaySeconds: calculateRetryDelaySeconds(attempts)
      });
    }
  }
}
__name(consumeIngestQueue, "consumeIngestQueue");

// src/utils/http.ts
function withNoStore(c) {
  c.header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  c.header("Pragma", "no-cache");
  c.header("Expires", "0");
}
__name(withNoStore, "withNoStore");
function withPublicCache(c, seconds = 120) {
  const sMaxAge = Math.max(1, Math.floor(seconds));
  const stale = Math.max(sMaxAge * 2, 120);
  c.header("Cache-Control", `public, s-maxage=${sMaxAge}, stale-while-revalidate=${stale}`);
}
__name(withPublicCache, "withPublicCache");
function jsonError(c, status, code, message2, details) {
  return c.json(
    {
      ok: false,
      error: {
        code,
        message: message2,
        ...details === void 0 ? {} : { details }
      }
    },
    status
  );
}
__name(jsonError, "jsonError");

// ../../node_modules/jose/dist/browser/runtime/webcrypto.js
var webcrypto_default = crypto;
var isCryptoKey = /* @__PURE__ */ __name((key) => key instanceof CryptoKey, "isCryptoKey");

// ../../node_modules/jose/dist/browser/lib/buffer_utils.js
var encoder = new TextEncoder();
var decoder = new TextDecoder();
var MAX_INT32 = 2 ** 32;
function concat(...buffers) {
  const size = buffers.reduce((acc, { length }) => acc + length, 0);
  const buf = new Uint8Array(size);
  let i = 0;
  for (const buffer of buffers) {
    buf.set(buffer, i);
    i += buffer.length;
  }
  return buf;
}
__name(concat, "concat");

// ../../node_modules/jose/dist/browser/runtime/base64url.js
var decodeBase64 = /* @__PURE__ */ __name((encoded) => {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}, "decodeBase64");
var decode = /* @__PURE__ */ __name((input) => {
  let encoded = input;
  if (encoded instanceof Uint8Array) {
    encoded = decoder.decode(encoded);
  }
  encoded = encoded.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
  try {
    return decodeBase64(encoded);
  } catch {
    throw new TypeError("The input to be decoded is not correctly encoded.");
  }
}, "decode");

// ../../node_modules/jose/dist/browser/util/errors.js
var JOSEError = class extends Error {
  static {
    __name(this, "JOSEError");
  }
  constructor(message2, options) {
    super(message2, options);
    this.code = "ERR_JOSE_GENERIC";
    this.name = this.constructor.name;
    Error.captureStackTrace?.(this, this.constructor);
  }
};
JOSEError.code = "ERR_JOSE_GENERIC";
var JWTClaimValidationFailed = class extends JOSEError {
  static {
    __name(this, "JWTClaimValidationFailed");
  }
  constructor(message2, payload, claim = "unspecified", reason = "unspecified") {
    super(message2, { cause: { claim, reason, payload } });
    this.code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
    this.claim = claim;
    this.reason = reason;
    this.payload = payload;
  }
};
JWTClaimValidationFailed.code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
var JWTExpired = class extends JOSEError {
  static {
    __name(this, "JWTExpired");
  }
  constructor(message2, payload, claim = "unspecified", reason = "unspecified") {
    super(message2, { cause: { claim, reason, payload } });
    this.code = "ERR_JWT_EXPIRED";
    this.claim = claim;
    this.reason = reason;
    this.payload = payload;
  }
};
JWTExpired.code = "ERR_JWT_EXPIRED";
var JOSEAlgNotAllowed = class extends JOSEError {
  static {
    __name(this, "JOSEAlgNotAllowed");
  }
  constructor() {
    super(...arguments);
    this.code = "ERR_JOSE_ALG_NOT_ALLOWED";
  }
};
JOSEAlgNotAllowed.code = "ERR_JOSE_ALG_NOT_ALLOWED";
var JOSENotSupported = class extends JOSEError {
  static {
    __name(this, "JOSENotSupported");
  }
  constructor() {
    super(...arguments);
    this.code = "ERR_JOSE_NOT_SUPPORTED";
  }
};
JOSENotSupported.code = "ERR_JOSE_NOT_SUPPORTED";
var JWEDecryptionFailed = class extends JOSEError {
  static {
    __name(this, "JWEDecryptionFailed");
  }
  constructor(message2 = "decryption operation failed", options) {
    super(message2, options);
    this.code = "ERR_JWE_DECRYPTION_FAILED";
  }
};
JWEDecryptionFailed.code = "ERR_JWE_DECRYPTION_FAILED";
var JWEInvalid = class extends JOSEError {
  static {
    __name(this, "JWEInvalid");
  }
  constructor() {
    super(...arguments);
    this.code = "ERR_JWE_INVALID";
  }
};
JWEInvalid.code = "ERR_JWE_INVALID";
var JWSInvalid = class extends JOSEError {
  static {
    __name(this, "JWSInvalid");
  }
  constructor() {
    super(...arguments);
    this.code = "ERR_JWS_INVALID";
  }
};
JWSInvalid.code = "ERR_JWS_INVALID";
var JWTInvalid = class extends JOSEError {
  static {
    __name(this, "JWTInvalid");
  }
  constructor() {
    super(...arguments);
    this.code = "ERR_JWT_INVALID";
  }
};
JWTInvalid.code = "ERR_JWT_INVALID";
var JWKInvalid = class extends JOSEError {
  static {
    __name(this, "JWKInvalid");
  }
  constructor() {
    super(...arguments);
    this.code = "ERR_JWK_INVALID";
  }
};
JWKInvalid.code = "ERR_JWK_INVALID";
var JWKSInvalid = class extends JOSEError {
  static {
    __name(this, "JWKSInvalid");
  }
  constructor() {
    super(...arguments);
    this.code = "ERR_JWKS_INVALID";
  }
};
JWKSInvalid.code = "ERR_JWKS_INVALID";
var JWKSNoMatchingKey = class extends JOSEError {
  static {
    __name(this, "JWKSNoMatchingKey");
  }
  constructor(message2 = "no applicable key found in the JSON Web Key Set", options) {
    super(message2, options);
    this.code = "ERR_JWKS_NO_MATCHING_KEY";
  }
};
JWKSNoMatchingKey.code = "ERR_JWKS_NO_MATCHING_KEY";
var JWKSMultipleMatchingKeys = class extends JOSEError {
  static {
    __name(this, "JWKSMultipleMatchingKeys");
  }
  constructor(message2 = "multiple matching keys found in the JSON Web Key Set", options) {
    super(message2, options);
    this.code = "ERR_JWKS_MULTIPLE_MATCHING_KEYS";
  }
};
JWKSMultipleMatchingKeys.code = "ERR_JWKS_MULTIPLE_MATCHING_KEYS";
var JWKSTimeout = class extends JOSEError {
  static {
    __name(this, "JWKSTimeout");
  }
  constructor(message2 = "request timed out", options) {
    super(message2, options);
    this.code = "ERR_JWKS_TIMEOUT";
  }
};
JWKSTimeout.code = "ERR_JWKS_TIMEOUT";
var JWSSignatureVerificationFailed = class extends JOSEError {
  static {
    __name(this, "JWSSignatureVerificationFailed");
  }
  constructor(message2 = "signature verification failed", options) {
    super(message2, options);
    this.code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
  }
};
JWSSignatureVerificationFailed.code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";

// ../../node_modules/jose/dist/browser/lib/crypto_key.js
function unusable(name, prop = "algorithm.name") {
  return new TypeError(`CryptoKey does not support this operation, its ${prop} must be ${name}`);
}
__name(unusable, "unusable");
function isAlgorithm(algorithm, name) {
  return algorithm.name === name;
}
__name(isAlgorithm, "isAlgorithm");
function getHashLength(hash) {
  return parseInt(hash.name.slice(4), 10);
}
__name(getHashLength, "getHashLength");
function getNamedCurve(alg) {
  switch (alg) {
    case "ES256":
      return "P-256";
    case "ES384":
      return "P-384";
    case "ES512":
      return "P-521";
    default:
      throw new Error("unreachable");
  }
}
__name(getNamedCurve, "getNamedCurve");
function checkUsage(key, usages) {
  if (usages.length && !usages.some((expected) => key.usages.includes(expected))) {
    let msg = "CryptoKey does not support this operation, its usages must include ";
    if (usages.length > 2) {
      const last = usages.pop();
      msg += `one of ${usages.join(", ")}, or ${last}.`;
    } else if (usages.length === 2) {
      msg += `one of ${usages[0]} or ${usages[1]}.`;
    } else {
      msg += `${usages[0]}.`;
    }
    throw new TypeError(msg);
  }
}
__name(checkUsage, "checkUsage");
function checkSigCryptoKey(key, alg, ...usages) {
  switch (alg) {
    case "HS256":
    case "HS384":
    case "HS512": {
      if (!isAlgorithm(key.algorithm, "HMAC"))
        throw unusable("HMAC");
      const expected = parseInt(alg.slice(2), 10);
      const actual = getHashLength(key.algorithm.hash);
      if (actual !== expected)
        throw unusable(`SHA-${expected}`, "algorithm.hash");
      break;
    }
    case "RS256":
    case "RS384":
    case "RS512": {
      if (!isAlgorithm(key.algorithm, "RSASSA-PKCS1-v1_5"))
        throw unusable("RSASSA-PKCS1-v1_5");
      const expected = parseInt(alg.slice(2), 10);
      const actual = getHashLength(key.algorithm.hash);
      if (actual !== expected)
        throw unusable(`SHA-${expected}`, "algorithm.hash");
      break;
    }
    case "PS256":
    case "PS384":
    case "PS512": {
      if (!isAlgorithm(key.algorithm, "RSA-PSS"))
        throw unusable("RSA-PSS");
      const expected = parseInt(alg.slice(2), 10);
      const actual = getHashLength(key.algorithm.hash);
      if (actual !== expected)
        throw unusable(`SHA-${expected}`, "algorithm.hash");
      break;
    }
    case "EdDSA": {
      if (key.algorithm.name !== "Ed25519" && key.algorithm.name !== "Ed448") {
        throw unusable("Ed25519 or Ed448");
      }
      break;
    }
    case "Ed25519": {
      if (!isAlgorithm(key.algorithm, "Ed25519"))
        throw unusable("Ed25519");
      break;
    }
    case "ES256":
    case "ES384":
    case "ES512": {
      if (!isAlgorithm(key.algorithm, "ECDSA"))
        throw unusable("ECDSA");
      const expected = getNamedCurve(alg);
      const actual = key.algorithm.namedCurve;
      if (actual !== expected)
        throw unusable(expected, "algorithm.namedCurve");
      break;
    }
    default:
      throw new TypeError("CryptoKey does not support this operation");
  }
  checkUsage(key, usages);
}
__name(checkSigCryptoKey, "checkSigCryptoKey");

// ../../node_modules/jose/dist/browser/lib/invalid_key_input.js
function message(msg, actual, ...types2) {
  types2 = types2.filter(Boolean);
  if (types2.length > 2) {
    const last = types2.pop();
    msg += `one of type ${types2.join(", ")}, or ${last}.`;
  } else if (types2.length === 2) {
    msg += `one of type ${types2[0]} or ${types2[1]}.`;
  } else {
    msg += `of type ${types2[0]}.`;
  }
  if (actual == null) {
    msg += ` Received ${actual}`;
  } else if (typeof actual === "function" && actual.name) {
    msg += ` Received function ${actual.name}`;
  } else if (typeof actual === "object" && actual != null) {
    if (actual.constructor?.name) {
      msg += ` Received an instance of ${actual.constructor.name}`;
    }
  }
  return msg;
}
__name(message, "message");
var invalid_key_input_default = /* @__PURE__ */ __name((actual, ...types2) => {
  return message("Key must be ", actual, ...types2);
}, "default");
function withAlg(alg, actual, ...types2) {
  return message(`Key for the ${alg} algorithm must be `, actual, ...types2);
}
__name(withAlg, "withAlg");

// ../../node_modules/jose/dist/browser/runtime/is_key_like.js
var is_key_like_default = /* @__PURE__ */ __name((key) => {
  if (isCryptoKey(key)) {
    return true;
  }
  return key?.[Symbol.toStringTag] === "KeyObject";
}, "default");
var types = ["CryptoKey"];

// ../../node_modules/jose/dist/browser/lib/is_disjoint.js
var isDisjoint = /* @__PURE__ */ __name((...headers) => {
  const sources = headers.filter(Boolean);
  if (sources.length === 0 || sources.length === 1) {
    return true;
  }
  let acc;
  for (const header of sources) {
    const parameters = Object.keys(header);
    if (!acc || acc.size === 0) {
      acc = new Set(parameters);
      continue;
    }
    for (const parameter of parameters) {
      if (acc.has(parameter)) {
        return false;
      }
      acc.add(parameter);
    }
  }
  return true;
}, "isDisjoint");
var is_disjoint_default = isDisjoint;

// ../../node_modules/jose/dist/browser/lib/is_object.js
function isObjectLike(value) {
  return typeof value === "object" && value !== null;
}
__name(isObjectLike, "isObjectLike");
function isObject2(input) {
  if (!isObjectLike(input) || Object.prototype.toString.call(input) !== "[object Object]") {
    return false;
  }
  if (Object.getPrototypeOf(input) === null) {
    return true;
  }
  let proto = input;
  while (Object.getPrototypeOf(proto) !== null) {
    proto = Object.getPrototypeOf(proto);
  }
  return Object.getPrototypeOf(input) === proto;
}
__name(isObject2, "isObject");

// ../../node_modules/jose/dist/browser/runtime/check_key_length.js
var check_key_length_default = /* @__PURE__ */ __name((alg, key) => {
  if (alg.startsWith("RS") || alg.startsWith("PS")) {
    const { modulusLength } = key.algorithm;
    if (typeof modulusLength !== "number" || modulusLength < 2048) {
      throw new TypeError(`${alg} requires key modulusLength to be 2048 bits or larger`);
    }
  }
}, "default");

// ../../node_modules/jose/dist/browser/lib/is_jwk.js
function isJWK(key) {
  return isObject2(key) && typeof key.kty === "string";
}
__name(isJWK, "isJWK");
function isPrivateJWK(key) {
  return key.kty !== "oct" && typeof key.d === "string";
}
__name(isPrivateJWK, "isPrivateJWK");
function isPublicJWK(key) {
  return key.kty !== "oct" && typeof key.d === "undefined";
}
__name(isPublicJWK, "isPublicJWK");
function isSecretJWK(key) {
  return isJWK(key) && key.kty === "oct" && typeof key.k === "string";
}
__name(isSecretJWK, "isSecretJWK");

// ../../node_modules/jose/dist/browser/runtime/jwk_to_key.js
function subtleMapping(jwk) {
  let algorithm;
  let keyUsages;
  switch (jwk.kty) {
    case "RSA": {
      switch (jwk.alg) {
        case "PS256":
        case "PS384":
        case "PS512":
          algorithm = { name: "RSA-PSS", hash: `SHA-${jwk.alg.slice(-3)}` };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "RS256":
        case "RS384":
        case "RS512":
          algorithm = { name: "RSASSA-PKCS1-v1_5", hash: `SHA-${jwk.alg.slice(-3)}` };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "RSA-OAEP":
        case "RSA-OAEP-256":
        case "RSA-OAEP-384":
        case "RSA-OAEP-512":
          algorithm = {
            name: "RSA-OAEP",
            hash: `SHA-${parseInt(jwk.alg.slice(-3), 10) || 1}`
          };
          keyUsages = jwk.d ? ["decrypt", "unwrapKey"] : ["encrypt", "wrapKey"];
          break;
        default:
          throw new JOSENotSupported('Invalid or unsupported JWK "alg" (Algorithm) Parameter value');
      }
      break;
    }
    case "EC": {
      switch (jwk.alg) {
        case "ES256":
          algorithm = { name: "ECDSA", namedCurve: "P-256" };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "ES384":
          algorithm = { name: "ECDSA", namedCurve: "P-384" };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "ES512":
          algorithm = { name: "ECDSA", namedCurve: "P-521" };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "ECDH-ES":
        case "ECDH-ES+A128KW":
        case "ECDH-ES+A192KW":
        case "ECDH-ES+A256KW":
          algorithm = { name: "ECDH", namedCurve: jwk.crv };
          keyUsages = jwk.d ? ["deriveBits"] : [];
          break;
        default:
          throw new JOSENotSupported('Invalid or unsupported JWK "alg" (Algorithm) Parameter value');
      }
      break;
    }
    case "OKP": {
      switch (jwk.alg) {
        case "Ed25519":
          algorithm = { name: "Ed25519" };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "EdDSA":
          algorithm = { name: jwk.crv };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "ECDH-ES":
        case "ECDH-ES+A128KW":
        case "ECDH-ES+A192KW":
        case "ECDH-ES+A256KW":
          algorithm = { name: jwk.crv };
          keyUsages = jwk.d ? ["deriveBits"] : [];
          break;
        default:
          throw new JOSENotSupported('Invalid or unsupported JWK "alg" (Algorithm) Parameter value');
      }
      break;
    }
    default:
      throw new JOSENotSupported('Invalid or unsupported JWK "kty" (Key Type) Parameter value');
  }
  return { algorithm, keyUsages };
}
__name(subtleMapping, "subtleMapping");
var parse = /* @__PURE__ */ __name(async (jwk) => {
  if (!jwk.alg) {
    throw new TypeError('"alg" argument is required when "jwk.alg" is not present');
  }
  const { algorithm, keyUsages } = subtleMapping(jwk);
  const rest = [
    algorithm,
    jwk.ext ?? false,
    jwk.key_ops ?? keyUsages
  ];
  const keyData = { ...jwk };
  delete keyData.alg;
  delete keyData.use;
  return webcrypto_default.subtle.importKey("jwk", keyData, ...rest);
}, "parse");
var jwk_to_key_default = parse;

// ../../node_modules/jose/dist/browser/runtime/normalize_key.js
var exportKeyValue = /* @__PURE__ */ __name((k) => decode(k), "exportKeyValue");
var privCache;
var pubCache;
var isKeyObject = /* @__PURE__ */ __name((key) => {
  return key?.[Symbol.toStringTag] === "KeyObject";
}, "isKeyObject");
var importAndCache = /* @__PURE__ */ __name(async (cache, key, jwk, alg, freeze = false) => {
  let cached = cache.get(key);
  if (cached?.[alg]) {
    return cached[alg];
  }
  const cryptoKey = await jwk_to_key_default({ ...jwk, alg });
  if (freeze)
    Object.freeze(key);
  if (!cached) {
    cache.set(key, { [alg]: cryptoKey });
  } else {
    cached[alg] = cryptoKey;
  }
  return cryptoKey;
}, "importAndCache");
var normalizePublicKey = /* @__PURE__ */ __name((key, alg) => {
  if (isKeyObject(key)) {
    let jwk = key.export({ format: "jwk" });
    delete jwk.d;
    delete jwk.dp;
    delete jwk.dq;
    delete jwk.p;
    delete jwk.q;
    delete jwk.qi;
    if (jwk.k) {
      return exportKeyValue(jwk.k);
    }
    pubCache || (pubCache = /* @__PURE__ */ new WeakMap());
    return importAndCache(pubCache, key, jwk, alg);
  }
  if (isJWK(key)) {
    if (key.k)
      return decode(key.k);
    pubCache || (pubCache = /* @__PURE__ */ new WeakMap());
    const cryptoKey = importAndCache(pubCache, key, key, alg, true);
    return cryptoKey;
  }
  return key;
}, "normalizePublicKey");
var normalizePrivateKey = /* @__PURE__ */ __name((key, alg) => {
  if (isKeyObject(key)) {
    let jwk = key.export({ format: "jwk" });
    if (jwk.k) {
      return exportKeyValue(jwk.k);
    }
    privCache || (privCache = /* @__PURE__ */ new WeakMap());
    return importAndCache(privCache, key, jwk, alg);
  }
  if (isJWK(key)) {
    if (key.k)
      return decode(key.k);
    privCache || (privCache = /* @__PURE__ */ new WeakMap());
    const cryptoKey = importAndCache(privCache, key, key, alg, true);
    return cryptoKey;
  }
  return key;
}, "normalizePrivateKey");
var normalize_key_default = { normalizePublicKey, normalizePrivateKey };

// ../../node_modules/jose/dist/browser/key/import.js
async function importJWK(jwk, alg) {
  if (!isObject2(jwk)) {
    throw new TypeError("JWK must be an object");
  }
  alg || (alg = jwk.alg);
  switch (jwk.kty) {
    case "oct":
      if (typeof jwk.k !== "string" || !jwk.k) {
        throw new TypeError('missing "k" (Key Value) Parameter value');
      }
      return decode(jwk.k);
    case "RSA":
      if ("oth" in jwk && jwk.oth !== void 0) {
        throw new JOSENotSupported('RSA JWK "oth" (Other Primes Info) Parameter value is not supported');
      }
    case "EC":
    case "OKP":
      return jwk_to_key_default({ ...jwk, alg });
    default:
      throw new JOSENotSupported('Unsupported "kty" (Key Type) Parameter value');
  }
}
__name(importJWK, "importJWK");

// ../../node_modules/jose/dist/browser/lib/check_key_type.js
var tag = /* @__PURE__ */ __name((key) => key?.[Symbol.toStringTag], "tag");
var jwkMatchesOp = /* @__PURE__ */ __name((alg, key, usage) => {
  if (key.use !== void 0 && key.use !== "sig") {
    throw new TypeError("Invalid key for this operation, when present its use must be sig");
  }
  if (key.key_ops !== void 0 && key.key_ops.includes?.(usage) !== true) {
    throw new TypeError(`Invalid key for this operation, when present its key_ops must include ${usage}`);
  }
  if (key.alg !== void 0 && key.alg !== alg) {
    throw new TypeError(`Invalid key for this operation, when present its alg must be ${alg}`);
  }
  return true;
}, "jwkMatchesOp");
var symmetricTypeCheck = /* @__PURE__ */ __name((alg, key, usage, allowJwk) => {
  if (key instanceof Uint8Array)
    return;
  if (allowJwk && isJWK(key)) {
    if (isSecretJWK(key) && jwkMatchesOp(alg, key, usage))
      return;
    throw new TypeError(`JSON Web Key for symmetric algorithms must have JWK "kty" (Key Type) equal to "oct" and the JWK "k" (Key Value) present`);
  }
  if (!is_key_like_default(key)) {
    throw new TypeError(withAlg(alg, key, ...types, "Uint8Array", allowJwk ? "JSON Web Key" : null));
  }
  if (key.type !== "secret") {
    throw new TypeError(`${tag(key)} instances for symmetric algorithms must be of type "secret"`);
  }
}, "symmetricTypeCheck");
var asymmetricTypeCheck = /* @__PURE__ */ __name((alg, key, usage, allowJwk) => {
  if (allowJwk && isJWK(key)) {
    switch (usage) {
      case "sign":
        if (isPrivateJWK(key) && jwkMatchesOp(alg, key, usage))
          return;
        throw new TypeError(`JSON Web Key for this operation be a private JWK`);
      case "verify":
        if (isPublicJWK(key) && jwkMatchesOp(alg, key, usage))
          return;
        throw new TypeError(`JSON Web Key for this operation be a public JWK`);
    }
  }
  if (!is_key_like_default(key)) {
    throw new TypeError(withAlg(alg, key, ...types, allowJwk ? "JSON Web Key" : null));
  }
  if (key.type === "secret") {
    throw new TypeError(`${tag(key)} instances for asymmetric algorithms must not be of type "secret"`);
  }
  if (usage === "sign" && key.type === "public") {
    throw new TypeError(`${tag(key)} instances for asymmetric algorithm signing must be of type "private"`);
  }
  if (usage === "decrypt" && key.type === "public") {
    throw new TypeError(`${tag(key)} instances for asymmetric algorithm decryption must be of type "private"`);
  }
  if (key.algorithm && usage === "verify" && key.type === "private") {
    throw new TypeError(`${tag(key)} instances for asymmetric algorithm verifying must be of type "public"`);
  }
  if (key.algorithm && usage === "encrypt" && key.type === "private") {
    throw new TypeError(`${tag(key)} instances for asymmetric algorithm encryption must be of type "public"`);
  }
}, "asymmetricTypeCheck");
function checkKeyType(allowJwk, alg, key, usage) {
  const symmetric = alg.startsWith("HS") || alg === "dir" || alg.startsWith("PBES2") || /^A\d{3}(?:GCM)?KW$/.test(alg);
  if (symmetric) {
    symmetricTypeCheck(alg, key, usage, allowJwk);
  } else {
    asymmetricTypeCheck(alg, key, usage, allowJwk);
  }
}
__name(checkKeyType, "checkKeyType");
var check_key_type_default = checkKeyType.bind(void 0, false);
var checkKeyTypeWithJwk = checkKeyType.bind(void 0, true);

// ../../node_modules/jose/dist/browser/lib/validate_crit.js
function validateCrit(Err, recognizedDefault, recognizedOption, protectedHeader, joseHeader) {
  if (joseHeader.crit !== void 0 && protectedHeader?.crit === void 0) {
    throw new Err('"crit" (Critical) Header Parameter MUST be integrity protected');
  }
  if (!protectedHeader || protectedHeader.crit === void 0) {
    return /* @__PURE__ */ new Set();
  }
  if (!Array.isArray(protectedHeader.crit) || protectedHeader.crit.length === 0 || protectedHeader.crit.some((input) => typeof input !== "string" || input.length === 0)) {
    throw new Err('"crit" (Critical) Header Parameter MUST be an array of non-empty strings when present');
  }
  let recognized;
  if (recognizedOption !== void 0) {
    recognized = new Map([...Object.entries(recognizedOption), ...recognizedDefault.entries()]);
  } else {
    recognized = recognizedDefault;
  }
  for (const parameter of protectedHeader.crit) {
    if (!recognized.has(parameter)) {
      throw new JOSENotSupported(`Extension Header Parameter "${parameter}" is not recognized`);
    }
    if (joseHeader[parameter] === void 0) {
      throw new Err(`Extension Header Parameter "${parameter}" is missing`);
    }
    if (recognized.get(parameter) && protectedHeader[parameter] === void 0) {
      throw new Err(`Extension Header Parameter "${parameter}" MUST be integrity protected`);
    }
  }
  return new Set(protectedHeader.crit);
}
__name(validateCrit, "validateCrit");
var validate_crit_default = validateCrit;

// ../../node_modules/jose/dist/browser/lib/validate_algorithms.js
var validateAlgorithms = /* @__PURE__ */ __name((option, algorithms) => {
  if (algorithms !== void 0 && (!Array.isArray(algorithms) || algorithms.some((s) => typeof s !== "string"))) {
    throw new TypeError(`"${option}" option must be an array of strings`);
  }
  if (!algorithms) {
    return void 0;
  }
  return new Set(algorithms);
}, "validateAlgorithms");
var validate_algorithms_default = validateAlgorithms;

// ../../node_modules/jose/dist/browser/runtime/subtle_dsa.js
function subtleDsa(alg, algorithm) {
  const hash = `SHA-${alg.slice(-3)}`;
  switch (alg) {
    case "HS256":
    case "HS384":
    case "HS512":
      return { hash, name: "HMAC" };
    case "PS256":
    case "PS384":
    case "PS512":
      return { hash, name: "RSA-PSS", saltLength: alg.slice(-3) >> 3 };
    case "RS256":
    case "RS384":
    case "RS512":
      return { hash, name: "RSASSA-PKCS1-v1_5" };
    case "ES256":
    case "ES384":
    case "ES512":
      return { hash, name: "ECDSA", namedCurve: algorithm.namedCurve };
    case "Ed25519":
      return { name: "Ed25519" };
    case "EdDSA":
      return { name: algorithm.name };
    default:
      throw new JOSENotSupported(`alg ${alg} is not supported either by JOSE or your javascript runtime`);
  }
}
__name(subtleDsa, "subtleDsa");

// ../../node_modules/jose/dist/browser/runtime/get_sign_verify_key.js
async function getCryptoKey(alg, key, usage) {
  if (usage === "sign") {
    key = await normalize_key_default.normalizePrivateKey(key, alg);
  }
  if (usage === "verify") {
    key = await normalize_key_default.normalizePublicKey(key, alg);
  }
  if (isCryptoKey(key)) {
    checkSigCryptoKey(key, alg, usage);
    return key;
  }
  if (key instanceof Uint8Array) {
    if (!alg.startsWith("HS")) {
      throw new TypeError(invalid_key_input_default(key, ...types));
    }
    return webcrypto_default.subtle.importKey("raw", key, { hash: `SHA-${alg.slice(-3)}`, name: "HMAC" }, false, [usage]);
  }
  throw new TypeError(invalid_key_input_default(key, ...types, "Uint8Array", "JSON Web Key"));
}
__name(getCryptoKey, "getCryptoKey");

// ../../node_modules/jose/dist/browser/runtime/verify.js
var verify = /* @__PURE__ */ __name(async (alg, key, signature, data) => {
  const cryptoKey = await getCryptoKey(alg, key, "verify");
  check_key_length_default(alg, cryptoKey);
  const algorithm = subtleDsa(alg, cryptoKey.algorithm);
  try {
    return await webcrypto_default.subtle.verify(algorithm, cryptoKey, signature, data);
  } catch {
    return false;
  }
}, "verify");
var verify_default = verify;

// ../../node_modules/jose/dist/browser/jws/flattened/verify.js
async function flattenedVerify(jws, key, options) {
  if (!isObject2(jws)) {
    throw new JWSInvalid("Flattened JWS must be an object");
  }
  if (jws.protected === void 0 && jws.header === void 0) {
    throw new JWSInvalid('Flattened JWS must have either of the "protected" or "header" members');
  }
  if (jws.protected !== void 0 && typeof jws.protected !== "string") {
    throw new JWSInvalid("JWS Protected Header incorrect type");
  }
  if (jws.payload === void 0) {
    throw new JWSInvalid("JWS Payload missing");
  }
  if (typeof jws.signature !== "string") {
    throw new JWSInvalid("JWS Signature missing or incorrect type");
  }
  if (jws.header !== void 0 && !isObject2(jws.header)) {
    throw new JWSInvalid("JWS Unprotected Header incorrect type");
  }
  let parsedProt = {};
  if (jws.protected) {
    try {
      const protectedHeader = decode(jws.protected);
      parsedProt = JSON.parse(decoder.decode(protectedHeader));
    } catch {
      throw new JWSInvalid("JWS Protected Header is invalid");
    }
  }
  if (!is_disjoint_default(parsedProt, jws.header)) {
    throw new JWSInvalid("JWS Protected and JWS Unprotected Header Parameter names must be disjoint");
  }
  const joseHeader = {
    ...parsedProt,
    ...jws.header
  };
  const extensions = validate_crit_default(JWSInvalid, /* @__PURE__ */ new Map([["b64", true]]), options?.crit, parsedProt, joseHeader);
  let b64 = true;
  if (extensions.has("b64")) {
    b64 = parsedProt.b64;
    if (typeof b64 !== "boolean") {
      throw new JWSInvalid('The "b64" (base64url-encode payload) Header Parameter must be a boolean');
    }
  }
  const { alg } = joseHeader;
  if (typeof alg !== "string" || !alg) {
    throw new JWSInvalid('JWS "alg" (Algorithm) Header Parameter missing or invalid');
  }
  const algorithms = options && validate_algorithms_default("algorithms", options.algorithms);
  if (algorithms && !algorithms.has(alg)) {
    throw new JOSEAlgNotAllowed('"alg" (Algorithm) Header Parameter value not allowed');
  }
  if (b64) {
    if (typeof jws.payload !== "string") {
      throw new JWSInvalid("JWS Payload must be a string");
    }
  } else if (typeof jws.payload !== "string" && !(jws.payload instanceof Uint8Array)) {
    throw new JWSInvalid("JWS Payload must be a string or an Uint8Array instance");
  }
  let resolvedKey = false;
  if (typeof key === "function") {
    key = await key(parsedProt, jws);
    resolvedKey = true;
    checkKeyTypeWithJwk(alg, key, "verify");
    if (isJWK(key)) {
      key = await importJWK(key, alg);
    }
  } else {
    checkKeyTypeWithJwk(alg, key, "verify");
  }
  const data = concat(encoder.encode(jws.protected ?? ""), encoder.encode("."), typeof jws.payload === "string" ? encoder.encode(jws.payload) : jws.payload);
  let signature;
  try {
    signature = decode(jws.signature);
  } catch {
    throw new JWSInvalid("Failed to base64url decode the signature");
  }
  const verified = await verify_default(alg, key, signature, data);
  if (!verified) {
    throw new JWSSignatureVerificationFailed();
  }
  let payload;
  if (b64) {
    try {
      payload = decode(jws.payload);
    } catch {
      throw new JWSInvalid("Failed to base64url decode the payload");
    }
  } else if (typeof jws.payload === "string") {
    payload = encoder.encode(jws.payload);
  } else {
    payload = jws.payload;
  }
  const result = { payload };
  if (jws.protected !== void 0) {
    result.protectedHeader = parsedProt;
  }
  if (jws.header !== void 0) {
    result.unprotectedHeader = jws.header;
  }
  if (resolvedKey) {
    return { ...result, key };
  }
  return result;
}
__name(flattenedVerify, "flattenedVerify");

// ../../node_modules/jose/dist/browser/jws/compact/verify.js
async function compactVerify(jws, key, options) {
  if (jws instanceof Uint8Array) {
    jws = decoder.decode(jws);
  }
  if (typeof jws !== "string") {
    throw new JWSInvalid("Compact JWS must be a string or Uint8Array");
  }
  const { 0: protectedHeader, 1: payload, 2: signature, length } = jws.split(".");
  if (length !== 3) {
    throw new JWSInvalid("Invalid Compact JWS");
  }
  const verified = await flattenedVerify({ payload, protected: protectedHeader, signature }, key, options);
  const result = { payload: verified.payload, protectedHeader: verified.protectedHeader };
  if (typeof key === "function") {
    return { ...result, key: verified.key };
  }
  return result;
}
__name(compactVerify, "compactVerify");

// ../../node_modules/jose/dist/browser/lib/epoch.js
var epoch_default = /* @__PURE__ */ __name((date) => Math.floor(date.getTime() / 1e3), "default");

// ../../node_modules/jose/dist/browser/lib/secs.js
var minute = 60;
var hour = minute * 60;
var day = hour * 24;
var week = day * 7;
var year = day * 365.25;
var REGEX = /^(\+|\-)? ?(\d+|\d+\.\d+) ?(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)(?: (ago|from now))?$/i;
var secs_default = /* @__PURE__ */ __name((str) => {
  const matched = REGEX.exec(str);
  if (!matched || matched[4] && matched[1]) {
    throw new TypeError("Invalid time period format");
  }
  const value = parseFloat(matched[2]);
  const unit = matched[3].toLowerCase();
  let numericDate;
  switch (unit) {
    case "sec":
    case "secs":
    case "second":
    case "seconds":
    case "s":
      numericDate = Math.round(value);
      break;
    case "minute":
    case "minutes":
    case "min":
    case "mins":
    case "m":
      numericDate = Math.round(value * minute);
      break;
    case "hour":
    case "hours":
    case "hr":
    case "hrs":
    case "h":
      numericDate = Math.round(value * hour);
      break;
    case "day":
    case "days":
    case "d":
      numericDate = Math.round(value * day);
      break;
    case "week":
    case "weeks":
    case "w":
      numericDate = Math.round(value * week);
      break;
    default:
      numericDate = Math.round(value * year);
      break;
  }
  if (matched[1] === "-" || matched[4] === "ago") {
    return -numericDate;
  }
  return numericDate;
}, "default");

// ../../node_modules/jose/dist/browser/lib/jwt_claims_set.js
var normalizeTyp = /* @__PURE__ */ __name((value) => value.toLowerCase().replace(/^application\//, ""), "normalizeTyp");
var checkAudiencePresence = /* @__PURE__ */ __name((audPayload, audOption) => {
  if (typeof audPayload === "string") {
    return audOption.includes(audPayload);
  }
  if (Array.isArray(audPayload)) {
    return audOption.some(Set.prototype.has.bind(new Set(audPayload)));
  }
  return false;
}, "checkAudiencePresence");
var jwt_claims_set_default = /* @__PURE__ */ __name((protectedHeader, encodedPayload, options = {}) => {
  let payload;
  try {
    payload = JSON.parse(decoder.decode(encodedPayload));
  } catch {
  }
  if (!isObject2(payload)) {
    throw new JWTInvalid("JWT Claims Set must be a top-level JSON object");
  }
  const { typ } = options;
  if (typ && (typeof protectedHeader.typ !== "string" || normalizeTyp(protectedHeader.typ) !== normalizeTyp(typ))) {
    throw new JWTClaimValidationFailed('unexpected "typ" JWT header value', payload, "typ", "check_failed");
  }
  const { requiredClaims = [], issuer, subject, audience, maxTokenAge } = options;
  const presenceCheck = [...requiredClaims];
  if (maxTokenAge !== void 0)
    presenceCheck.push("iat");
  if (audience !== void 0)
    presenceCheck.push("aud");
  if (subject !== void 0)
    presenceCheck.push("sub");
  if (issuer !== void 0)
    presenceCheck.push("iss");
  for (const claim of new Set(presenceCheck.reverse())) {
    if (!(claim in payload)) {
      throw new JWTClaimValidationFailed(`missing required "${claim}" claim`, payload, claim, "missing");
    }
  }
  if (issuer && !(Array.isArray(issuer) ? issuer : [issuer]).includes(payload.iss)) {
    throw new JWTClaimValidationFailed('unexpected "iss" claim value', payload, "iss", "check_failed");
  }
  if (subject && payload.sub !== subject) {
    throw new JWTClaimValidationFailed('unexpected "sub" claim value', payload, "sub", "check_failed");
  }
  if (audience && !checkAudiencePresence(payload.aud, typeof audience === "string" ? [audience] : audience)) {
    throw new JWTClaimValidationFailed('unexpected "aud" claim value', payload, "aud", "check_failed");
  }
  let tolerance;
  switch (typeof options.clockTolerance) {
    case "string":
      tolerance = secs_default(options.clockTolerance);
      break;
    case "number":
      tolerance = options.clockTolerance;
      break;
    case "undefined":
      tolerance = 0;
      break;
    default:
      throw new TypeError("Invalid clockTolerance option type");
  }
  const { currentDate } = options;
  const now = epoch_default(currentDate || /* @__PURE__ */ new Date());
  if ((payload.iat !== void 0 || maxTokenAge) && typeof payload.iat !== "number") {
    throw new JWTClaimValidationFailed('"iat" claim must be a number', payload, "iat", "invalid");
  }
  if (payload.nbf !== void 0) {
    if (typeof payload.nbf !== "number") {
      throw new JWTClaimValidationFailed('"nbf" claim must be a number', payload, "nbf", "invalid");
    }
    if (payload.nbf > now + tolerance) {
      throw new JWTClaimValidationFailed('"nbf" claim timestamp check failed', payload, "nbf", "check_failed");
    }
  }
  if (payload.exp !== void 0) {
    if (typeof payload.exp !== "number") {
      throw new JWTClaimValidationFailed('"exp" claim must be a number', payload, "exp", "invalid");
    }
    if (payload.exp <= now - tolerance) {
      throw new JWTExpired('"exp" claim timestamp check failed', payload, "exp", "check_failed");
    }
  }
  if (maxTokenAge) {
    const age = now - payload.iat;
    const max = typeof maxTokenAge === "number" ? maxTokenAge : secs_default(maxTokenAge);
    if (age - tolerance > max) {
      throw new JWTExpired('"iat" claim timestamp check failed (too far in the past)', payload, "iat", "check_failed");
    }
    if (age < 0 - tolerance) {
      throw new JWTClaimValidationFailed('"iat" claim timestamp check failed (it should be in the past)', payload, "iat", "check_failed");
    }
  }
  return payload;
}, "default");

// ../../node_modules/jose/dist/browser/jwt/verify.js
async function jwtVerify(jwt, key, options) {
  const verified = await compactVerify(jwt, key, options);
  if (verified.protectedHeader.crit?.includes("b64") && verified.protectedHeader.b64 === false) {
    throw new JWTInvalid("JWTs MUST NOT use unencoded payload");
  }
  const payload = jwt_claims_set_default(verified.protectedHeader, verified.payload, options);
  const result = { payload, protectedHeader: verified.protectedHeader };
  if (typeof key === "function") {
    return { ...result, key: verified.key };
  }
  return result;
}
__name(jwtVerify, "jwtVerify");

// ../../node_modules/jose/dist/browser/jwks/local.js
function getKtyFromAlg(alg) {
  switch (typeof alg === "string" && alg.slice(0, 2)) {
    case "RS":
    case "PS":
      return "RSA";
    case "ES":
      return "EC";
    case "Ed":
      return "OKP";
    default:
      throw new JOSENotSupported('Unsupported "alg" value for a JSON Web Key Set');
  }
}
__name(getKtyFromAlg, "getKtyFromAlg");
function isJWKSLike(jwks) {
  return jwks && typeof jwks === "object" && Array.isArray(jwks.keys) && jwks.keys.every(isJWKLike);
}
__name(isJWKSLike, "isJWKSLike");
function isJWKLike(key) {
  return isObject2(key);
}
__name(isJWKLike, "isJWKLike");
function clone(obj) {
  if (typeof structuredClone === "function") {
    return structuredClone(obj);
  }
  return JSON.parse(JSON.stringify(obj));
}
__name(clone, "clone");
var LocalJWKSet = class {
  static {
    __name(this, "LocalJWKSet");
  }
  constructor(jwks) {
    this._cached = /* @__PURE__ */ new WeakMap();
    if (!isJWKSLike(jwks)) {
      throw new JWKSInvalid("JSON Web Key Set malformed");
    }
    this._jwks = clone(jwks);
  }
  async getKey(protectedHeader, token) {
    const { alg, kid } = { ...protectedHeader, ...token?.header };
    const kty = getKtyFromAlg(alg);
    const candidates = this._jwks.keys.filter((jwk2) => {
      let candidate = kty === jwk2.kty;
      if (candidate && typeof kid === "string") {
        candidate = kid === jwk2.kid;
      }
      if (candidate && typeof jwk2.alg === "string") {
        candidate = alg === jwk2.alg;
      }
      if (candidate && typeof jwk2.use === "string") {
        candidate = jwk2.use === "sig";
      }
      if (candidate && Array.isArray(jwk2.key_ops)) {
        candidate = jwk2.key_ops.includes("verify");
      }
      if (candidate) {
        switch (alg) {
          case "ES256":
            candidate = jwk2.crv === "P-256";
            break;
          case "ES256K":
            candidate = jwk2.crv === "secp256k1";
            break;
          case "ES384":
            candidate = jwk2.crv === "P-384";
            break;
          case "ES512":
            candidate = jwk2.crv === "P-521";
            break;
          case "Ed25519":
            candidate = jwk2.crv === "Ed25519";
            break;
          case "EdDSA":
            candidate = jwk2.crv === "Ed25519" || jwk2.crv === "Ed448";
            break;
        }
      }
      return candidate;
    });
    const { 0: jwk, length } = candidates;
    if (length === 0) {
      throw new JWKSNoMatchingKey();
    }
    if (length !== 1) {
      const error = new JWKSMultipleMatchingKeys();
      const { _cached } = this;
      error[Symbol.asyncIterator] = async function* () {
        for (const jwk2 of candidates) {
          try {
            yield await importWithAlgCache(_cached, jwk2, alg);
          } catch {
          }
        }
      };
      throw error;
    }
    return importWithAlgCache(this._cached, jwk, alg);
  }
};
async function importWithAlgCache(cache, jwk, alg) {
  const cached = cache.get(jwk) || cache.set(jwk, {}).get(jwk);
  if (cached[alg] === void 0) {
    const key = await importJWK({ ...jwk, ext: true }, alg);
    if (key instanceof Uint8Array || key.type !== "public") {
      throw new JWKSInvalid("JSON Web Key Set members must be public keys");
    }
    cached[alg] = key;
  }
  return cached[alg];
}
__name(importWithAlgCache, "importWithAlgCache");
function createLocalJWKSet(jwks) {
  const set = new LocalJWKSet(jwks);
  const localJWKSet = /* @__PURE__ */ __name(async (protectedHeader, token) => set.getKey(protectedHeader, token), "localJWKSet");
  Object.defineProperties(localJWKSet, {
    jwks: {
      value: /* @__PURE__ */ __name(() => clone(set._jwks), "value"),
      enumerable: true,
      configurable: false,
      writable: false
    }
  });
  return localJWKSet;
}
__name(createLocalJWKSet, "createLocalJWKSet");

// ../../node_modules/jose/dist/browser/runtime/fetch_jwks.js
var fetchJwks = /* @__PURE__ */ __name(async (url, timeout, options) => {
  let controller;
  let id;
  let timedOut = false;
  if (typeof AbortController === "function") {
    controller = new AbortController();
    id = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeout);
  }
  const response = await fetch(url.href, {
    signal: controller ? controller.signal : void 0,
    redirect: "manual",
    headers: options.headers
  }).catch((err) => {
    if (timedOut)
      throw new JWKSTimeout();
    throw err;
  });
  if (id !== void 0)
    clearTimeout(id);
  if (response.status !== 200) {
    throw new JOSEError("Expected 200 OK from the JSON Web Key Set HTTP response");
  }
  try {
    return await response.json();
  } catch {
    throw new JOSEError("Failed to parse the JSON Web Key Set HTTP response as JSON");
  }
}, "fetchJwks");
var fetch_jwks_default = fetchJwks;

// ../../node_modules/jose/dist/browser/jwks/remote.js
function isCloudflareWorkers() {
  return typeof WebSocketPair !== "undefined" || typeof navigator !== "undefined" && true || typeof EdgeRuntime !== "undefined" && EdgeRuntime === "vercel";
}
__name(isCloudflareWorkers, "isCloudflareWorkers");
var USER_AGENT;
if (typeof navigator === "undefined" || !"Cloudflare-Workers"?.startsWith?.("Mozilla/5.0 ")) {
  const NAME = "jose";
  const VERSION = "v5.10.0";
  USER_AGENT = `${NAME}/${VERSION}`;
}
var jwksCache = /* @__PURE__ */ Symbol();
function isFreshJwksCache(input, cacheMaxAge) {
  if (typeof input !== "object" || input === null) {
    return false;
  }
  if (!("uat" in input) || typeof input.uat !== "number" || Date.now() - input.uat >= cacheMaxAge) {
    return false;
  }
  if (!("jwks" in input) || !isObject2(input.jwks) || !Array.isArray(input.jwks.keys) || !Array.prototype.every.call(input.jwks.keys, isObject2)) {
    return false;
  }
  return true;
}
__name(isFreshJwksCache, "isFreshJwksCache");
var RemoteJWKSet = class {
  static {
    __name(this, "RemoteJWKSet");
  }
  constructor(url, options) {
    if (!(url instanceof URL)) {
      throw new TypeError("url must be an instance of URL");
    }
    this._url = new URL(url.href);
    this._options = { agent: options?.agent, headers: options?.headers };
    this._timeoutDuration = typeof options?.timeoutDuration === "number" ? options?.timeoutDuration : 5e3;
    this._cooldownDuration = typeof options?.cooldownDuration === "number" ? options?.cooldownDuration : 3e4;
    this._cacheMaxAge = typeof options?.cacheMaxAge === "number" ? options?.cacheMaxAge : 6e5;
    if (options?.[jwksCache] !== void 0) {
      this._cache = options?.[jwksCache];
      if (isFreshJwksCache(options?.[jwksCache], this._cacheMaxAge)) {
        this._jwksTimestamp = this._cache.uat;
        this._local = createLocalJWKSet(this._cache.jwks);
      }
    }
  }
  coolingDown() {
    return typeof this._jwksTimestamp === "number" ? Date.now() < this._jwksTimestamp + this._cooldownDuration : false;
  }
  fresh() {
    return typeof this._jwksTimestamp === "number" ? Date.now() < this._jwksTimestamp + this._cacheMaxAge : false;
  }
  async getKey(protectedHeader, token) {
    if (!this._local || !this.fresh()) {
      await this.reload();
    }
    try {
      return await this._local(protectedHeader, token);
    } catch (err) {
      if (err instanceof JWKSNoMatchingKey) {
        if (this.coolingDown() === false) {
          await this.reload();
          return this._local(protectedHeader, token);
        }
      }
      throw err;
    }
  }
  async reload() {
    if (this._pendingFetch && isCloudflareWorkers()) {
      this._pendingFetch = void 0;
    }
    const headers = new Headers(this._options.headers);
    if (USER_AGENT && !headers.has("User-Agent")) {
      headers.set("User-Agent", USER_AGENT);
      this._options.headers = Object.fromEntries(headers.entries());
    }
    this._pendingFetch || (this._pendingFetch = fetch_jwks_default(this._url, this._timeoutDuration, this._options).then((json) => {
      this._local = createLocalJWKSet(json);
      if (this._cache) {
        this._cache.uat = Date.now();
        this._cache.jwks = json;
      }
      this._jwksTimestamp = Date.now();
      this._pendingFetch = void 0;
    }).catch((err) => {
      this._pendingFetch = void 0;
      throw err;
    }));
    await this._pendingFetch;
  }
};
function createRemoteJWKSet(url, options) {
  const set = new RemoteJWKSet(url, options);
  const remoteJWKSet = /* @__PURE__ */ __name(async (protectedHeader, token) => set.getKey(protectedHeader, token), "remoteJWKSet");
  Object.defineProperties(remoteJWKSet, {
    coolingDown: {
      get: /* @__PURE__ */ __name(() => set.coolingDown(), "get"),
      enumerable: true,
      configurable: false
    },
    fresh: {
      get: /* @__PURE__ */ __name(() => set.fresh(), "get"),
      enumerable: true,
      configurable: false
    },
    reload: {
      value: /* @__PURE__ */ __name(() => set.reload(), "value"),
      enumerable: true,
      configurable: false,
      writable: false
    },
    reloading: {
      get: /* @__PURE__ */ __name(() => !!set._pendingFetch, "get"),
      enumerable: true,
      configurable: false
    },
    jwks: {
      value: /* @__PURE__ */ __name(() => set._local?.jwks(), "value"),
      enumerable: true,
      configurable: false,
      writable: false
    }
  });
  return remoteJWKSet;
}
__name(createRemoteJWKSet, "createRemoteJWKSet");

// src/auth/access-jwt.ts
var jwksCache2 = /* @__PURE__ */ new Map();
function normalizeTeamDomain(teamDomain) {
  return teamDomain.replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
}
__name(normalizeTeamDomain, "normalizeTeamDomain");
function getRemoteJwks(teamDomain) {
  const normalized = normalizeTeamDomain(teamDomain);
  const cached = jwksCache2.get(normalized);
  if (cached) {
    return cached;
  }
  const jwks = createRemoteJWKSet(new URL(`https://${normalized}/cdn-cgi/access/certs`));
  jwksCache2.set(normalized, jwks);
  return jwks;
}
__name(getRemoteJwks, "getRemoteJwks");
async function verifyAccessJwtToken(token, params) {
  if (!token) {
    return { ok: false, reason: "missing_access_jwt" };
  }
  const teamDomain = String(params.teamDomain ?? "").trim();
  const audience = String(params.audience ?? "").trim();
  if (!teamDomain || !audience) {
    return { ok: false, reason: "access_not_configured" };
  }
  const issuer = `https://${normalizeTeamDomain(teamDomain)}`;
  const jwks = getRemoteJwks(teamDomain);
  try {
    const verified = await jwtVerify(token, jwks, {
      issuer,
      audience
    });
    return {
      ok: true,
      payload: verified.payload
    };
  } catch (error) {
    return {
      ok: false,
      reason: error?.message || "invalid_access_jwt"
    };
  }
}
__name(verifyAccessJwtToken, "verifyAccessJwtToken");

// src/auth/admin.ts
function parseBearerToken(value) {
  if (!value) {
    return null;
  }
  const match2 = /^Bearer\s+(.+)$/i.exec(value.trim());
  if (!match2) {
    return null;
  }
  const token = match2[1].trim();
  return token || null;
}
__name(parseBearerToken, "parseBearerToken");
function isBearerTokenAuthorized(providedToken, expectedToken) {
  const expected = String(expectedToken ?? "").trim();
  if (!providedToken || !expected) {
    return false;
  }
  if (providedToken.length !== expected.length) {
    return false;
  }
  const encoder2 = new TextEncoder();
  const a = encoder2.encode(providedToken);
  const b = encoder2.encode(expected);
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.byteLength; i++) {
    mismatch |= a[i] ^ b[i];
  }
  return mismatch === 0;
}
__name(isBearerTokenAuthorized, "isBearerTokenAuthorized");
async function evaluateAdminAuth(c) {
  const bearerToken = parseBearerToken(c.req.header("Authorization"));
  const expectedToken = c.env.ADMIN_API_TOKEN;
  if (isBearerTokenAuthorized(bearerToken, expectedToken)) {
    return {
      ok: true,
      mode: "bearer",
      subject: "admin-token"
    };
  }
  const accessAssertion = c.req.header("Cf-Access-Jwt-Assertion");
  if (accessAssertion) {
    const accessResult = await verifyAccessJwtToken(accessAssertion, {
      teamDomain: c.env.CF_ACCESS_TEAM_DOMAIN,
      audience: c.env.CF_ACCESS_AUD
    });
    if (accessResult.ok) {
      return {
        ok: true,
        mode: "access",
        subject: String(accessResult.payload?.sub || "access-user"),
        jwtPayload: accessResult.payload
      };
    }
    return {
      ok: false,
      mode: null,
      reason: accessResult.reason || "invalid_access_jwt"
    };
  }
  if (bearerToken && !isBearerTokenAuthorized(bearerToken, expectedToken)) {
    return {
      ok: false,
      mode: null,
      reason: "invalid_bearer_token"
    };
  }
  return {
    ok: false,
    mode: null,
    reason: "admin_token_or_access_jwt_required"
  };
}
__name(evaluateAdminAuth, "evaluateAdminAuth");
function requireAdmin() {
  return async (c, next) => {
    withNoStore(c);
    const authState = await evaluateAdminAuth(c);
    c.set("adminAuthState", authState);
    if (!authState.ok) {
      return jsonError(c, 401, "UNAUTHORIZED", "Admin authentication failed.", {
        reason: authState.reason
      });
    }
    await next();
  };
}
__name(requireAdmin, "requireAdmin");

// src/routes/admin-config.ts
var APP_CONFIG_TABLE2 = "app_config";
var SAFE_ENV_KEYS = [
  "WORKER_VERSION",
  "PUBLIC_API_BASE_PATH",
  "MELBOURNE_TIMEZONE",
  "MELBOURNE_TARGET_HOUR",
  "MANUAL_RUN_COOLDOWN_SECONDS",
  "LOCK_TTL_SECONDS",
  "MAX_QUEUE_ATTEMPTS",
  "FEATURE_PROSPECTIVE_ENABLED",
  "FEATURE_BACKFILL_ENABLED",
  "CF_ACCESS_TEAM_DOMAIN",
  "CF_ACCESS_AUD"
];
var adminConfigRoutes = new Hono2();
adminConfigRoutes.get("/config", async (c) => {
  const db = c.env.DB;
  const stmt = db.prepare(`SELECT key, value, updated_at FROM ${APP_CONFIG_TABLE2} ORDER BY key`);
  const result = await stmt.all();
  const rows4 = result.results || [];
  return c.json({
    ok: true,
    auth_mode: c.get("adminAuthState")?.mode ?? null,
    config: rows4
  });
});
adminConfigRoutes.put("/config", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.key !== "string" || body.key.trim() === "") {
    return jsonError(c, 400, "BAD_REQUEST", "Missing or invalid key");
  }
  const key = String(body.key).trim();
  const value = typeof body.value === "string" ? body.value : String(body.value ?? "");
  const db = c.env.DB;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await db.prepare(
    `INSERT INTO ${APP_CONFIG_TABLE2} (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(key, value, now).run();
  const row = await db.prepare(`SELECT key, value, updated_at FROM ${APP_CONFIG_TABLE2} WHERE key = ?`).bind(key).first();
  return c.json({
    ok: true,
    auth_mode: c.get("adminAuthState")?.mode ?? null,
    row: row ?? { key, value, updated_at: now }
  });
});
adminConfigRoutes.delete("/config", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.key !== "string" || body.key.trim() === "") {
    return jsonError(c, 400, "BAD_REQUEST", "Missing or invalid key");
  }
  const key = String(body.key).trim();
  const db = c.env.DB;
  const result = await db.prepare(`DELETE FROM ${APP_CONFIG_TABLE2} WHERE key = ?`).bind(key).run();
  return c.json({
    ok: true,
    auth_mode: c.get("adminAuthState")?.mode ?? null,
    deleted: (result.meta.changes ?? 0) > 0
  });
});
adminConfigRoutes.get("/env", async (c) => {
  const env = c.env;
  const out = {};
  for (const k of SAFE_ENV_KEYS) {
    const v = env[k];
    if (v !== void 0 && v !== null) out[k] = String(v);
  }
  return c.json({
    ok: true,
    auth_mode: c.get("adminAuthState")?.mode ?? null,
    env: out
  });
});

// src/routes/admin-db.ts
var ADMIN_DB_TABLES = [
  "historical_loan_rates",
  "historical_savings_rates",
  "historical_term_deposit_rates",
  "raw_payloads",
  "run_reports",
  "lender_endpoint_cache",
  "brand_normalization_map",
  "backfill_cursors",
  "rba_cash_rates",
  "global_log"
];
function isAllowedTable(name) {
  return ADMIN_DB_TABLES.includes(name);
}
__name(isAllowedTable, "isAllowedTable");
var TABLE_KEY_COLUMNS = {
  historical_loan_rates: [
    "bank_name",
    "collection_date",
    "product_id",
    "lvr_tier",
    "rate_structure",
    "security_purpose",
    "repayment_type",
    "run_source"
  ],
  historical_savings_rates: [
    "bank_name",
    "collection_date",
    "product_id",
    "rate_type",
    "deposit_tier",
    "run_source"
  ],
  historical_term_deposit_rates: [
    "bank_name",
    "collection_date",
    "product_id",
    "term_months",
    "deposit_tier",
    "run_source"
  ],
  raw_payloads: ["id"],
  run_reports: ["run_id"],
  lender_endpoint_cache: ["lender_code"],
  brand_normalization_map: ["id"],
  backfill_cursors: ["cursor_key"],
  rba_cash_rates: ["collection_date"],
  global_log: ["id"]
};
var adminDbRoutes = new Hono2();
adminDbRoutes.get("/db/tables", async (c) => {
  const db = c.env.DB;
  const withCounts = c.req.query("counts") === "true";
  const tables = [];
  for (const name of ADMIN_DB_TABLES) {
    if (!withCounts) {
      tables.push({ name });
      continue;
    }
    try {
      const r = await db.prepare(`SELECT count(*) as n FROM ${name}`).first();
      tables.push({ name, count: r?.n ?? 0 });
    } catch {
      tables.push({ name, count: 0 });
    }
  }
  return c.json({
    ok: true,
    auth_mode: c.get("adminAuthState")?.mode ?? null,
    tables
  });
});
adminDbRoutes.get("/db/tables/:tableName/schema", async (c) => {
  const tableName = c.req.param("tableName");
  if (!isAllowedTable(tableName)) {
    return jsonError(c, 400, "BAD_REQUEST", `Table not allowed: ${tableName}`);
  }
  const db = c.env.DB;
  const pragma = await db.prepare(`PRAGMA table_info(${tableName})`).all();
  const results = pragma.results ?? [];
  const columns = results.map((r) => ({
    name: r.name,
    type: r.type || "TEXT",
    notnull: r.notnull === 1,
    pk: r.pk === 1,
    dflt_value: r.dflt_value ?? void 0
  }));
  const keyCols = TABLE_KEY_COLUMNS[tableName];
  const hasAutoPk = columns.some((col) => col.name === "id" && col.pk) && keyCols.length === 1 && keyCols[0] === "id";
  return c.json({
    ok: true,
    auth_mode: c.get("adminAuthState")?.mode ?? null,
    table: tableName,
    columns,
    key_columns: keyCols,
    has_auto_increment_pk: hasAutoPk
  });
});
adminDbRoutes.get("/db/tables/:tableName/rows", async (c) => {
  const tableName = c.req.param("tableName");
  if (!isAllowedTable(tableName)) {
    return jsonError(c, 400, "BAD_REQUEST", `Table not allowed: ${tableName}`);
  }
  const limit = Math.min(Math.max(1, Number(c.req.query("limit")) || 50), 500);
  const offset = Math.max(0, Number(c.req.query("offset")) || 0);
  const sortCol = (c.req.query("sort") || "").trim() || null;
  const sortDir = (c.req.query("dir") || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
  const db = c.env.DB;
  const pragma = await db.prepare(`PRAGMA table_info(${tableName})`).all();
  const colNames = (pragma.results ?? []).map((r) => r.name);
  const orderCol = sortCol && colNames.includes(sortCol) ? sortCol : colNames[0] ?? "1";
  const orderBy = `ORDER BY ${orderCol} ${sortDir}`;
  const countResult = await db.prepare(`SELECT count(*) as n FROM ${tableName}`).first();
  const total = countResult?.n ?? 0;
  const rowsStmt = `SELECT * FROM ${tableName} ${orderBy} LIMIT ? OFFSET ?`;
  const rowsResult = await db.prepare(rowsStmt).bind(limit, offset).all();
  const rows4 = rowsResult.results ?? [];
  return c.json({
    ok: true,
    auth_mode: c.get("adminAuthState")?.mode ?? null,
    rows: rows4,
    total,
    limit,
    offset
  });
});
adminDbRoutes.post("/db/tables/:tableName/rows/by-key", async (c) => {
  const tableName = c.req.param("tableName");
  if (!isAllowedTable(tableName)) {
    return jsonError(c, 400, "BAD_REQUEST", `Table not allowed: ${tableName}`);
  }
  const body = await c.req.json().catch(() => ({}));
  const keyCols = TABLE_KEY_COLUMNS[tableName];
  const whereParts = [];
  const values = [];
  for (const col of keyCols) {
    const v = body[col];
    if (v === void 0 || v === null) {
      return jsonError(c, 400, "BAD_REQUEST", `Missing key column: ${col}`);
    }
    whereParts.push(`${col} = ?`);
    values.push(v);
  }
  const where = whereParts.join(" AND ");
  const db = c.env.DB;
  const row = await db.prepare(`SELECT * FROM ${tableName} WHERE ${where}`).bind(...values).first();
  if (!row) {
    return jsonError(c, 404, "NOT_FOUND", "Row not found");
  }
  return c.json({ ok: true, auth_mode: c.get("adminAuthState")?.mode ?? null, row });
});
adminDbRoutes.post("/db/tables/:tableName/rows", async (c) => {
  const tableName = c.req.param("tableName");
  if (!isAllowedTable(tableName)) {
    return jsonError(c, 400, "BAD_REQUEST", `Table not allowed: ${tableName}`);
  }
  const body = await c.req.json().catch(() => ({}));
  const db = c.env.DB;
  const pragma = await db.prepare(`PRAGMA table_info(${tableName})`).all();
  const colInfos = pragma.results ?? [];
  const colNames = colInfos.map((r) => r.name).filter((n) => body[n] !== void 0);
  if (colNames.length === 0) {
    return jsonError(c, 400, "BAD_REQUEST", "No columns provided");
  }
  const placeholders = colNames.map(() => "?").join(", ");
  const cols = colNames.join(", ");
  const values = colNames.map((n) => body[n]);
  try {
    await db.prepare(`INSERT INTO ${tableName} (${cols}) VALUES (${placeholders})`).bind(...values).run();
  } catch (e) {
    const msg = e?.message ?? String(e);
    return jsonError(c, 400, "CONSTRAINT_VIOLATION", msg, { details: msg });
  }
  const keyCols = TABLE_KEY_COLUMNS[tableName];
  if (keyCols.length === 1 && body[keyCols[0]] !== void 0) {
    const keyVal = body[keyCols[0]];
    const row = await db.prepare(`SELECT * FROM ${tableName} WHERE ${keyCols[0]} = ?`).bind(keyVal).first();
    return c.json({ ok: true, auth_mode: c.get("adminAuthState")?.mode ?? null, row: row ?? body });
  }
  return c.json({ ok: true, auth_mode: c.get("adminAuthState")?.mode ?? null, row: body });
});
adminDbRoutes.put("/db/tables/:tableName/rows", async (c) => {
  const tableName = c.req.param("tableName");
  if (!isAllowedTable(tableName)) {
    return jsonError(c, 400, "BAD_REQUEST", `Table not allowed: ${tableName}`);
  }
  const body = await c.req.json().catch(() => ({}));
  const keyCols = TABLE_KEY_COLUMNS[tableName];
  const db = c.env.DB;
  const pragma = await db.prepare(`PRAGMA table_info(${tableName})`).all();
  const allCols = (pragma.results ?? []).map((r) => r.name);
  const setCols = allCols.filter((col) => !keyCols.includes(col) && body[col] !== void 0);
  if (setCols.length === 0) {
    return jsonError(c, 400, "BAD_REQUEST", "No non-key columns to update");
  }
  const whereParts = [];
  const bindValues = [];
  for (const col of keyCols) {
    const v = body[col];
    if (v === void 0 || v === null) {
      return jsonError(c, 400, "BAD_REQUEST", `Missing key column: ${col}`);
    }
    whereParts.push(`${col} = ?`);
    bindValues.push(v);
  }
  const setParts = setCols.map((col) => `${col} = ?`);
  for (const col of setCols) {
    bindValues.push(body[col]);
  }
  const setClause = setParts.join(", ");
  const where = whereParts.join(" AND ");
  try {
    const result = await db.prepare(`UPDATE ${tableName} SET ${setClause} WHERE ${where}`).bind(...bindValues).run();
    if ((result.meta.changes ?? 0) === 0) {
      return jsonError(c, 404, "NOT_FOUND", "No row matched the key");
    }
  } catch (e) {
    const msg = e?.message ?? String(e);
    return jsonError(c, 400, "CONSTRAINT_VIOLATION", msg, { details: msg });
  }
  const row = await db.prepare(`SELECT * FROM ${tableName} WHERE ${where}`).bind(...keyCols.map((col) => body[col])).first();
  return c.json({ ok: true, auth_mode: c.get("adminAuthState")?.mode ?? null, row: row ?? body });
});
adminDbRoutes.delete("/db/tables/:tableName/rows", async (c) => {
  const tableName = c.req.param("tableName");
  if (!isAllowedTable(tableName)) {
    return jsonError(c, 400, "BAD_REQUEST", `Table not allowed: ${tableName}`);
  }
  const body = await c.req.json().catch(() => ({}));
  const keyCols = TABLE_KEY_COLUMNS[tableName];
  const whereParts = [];
  const values = [];
  for (const col of keyCols) {
    const v = body[col];
    if (v === void 0 || v === null) {
      return jsonError(c, 400, "BAD_REQUEST", `Missing key column: ${col}`);
    }
    whereParts.push(`${col} = ?`);
    values.push(v);
  }
  const where = whereParts.join(" AND ");
  const db = c.env.DB;
  const result = await db.prepare(`DELETE FROM ${tableName} WHERE ${where}`).bind(...values).run();
  if ((result.meta.changes ?? 0) === 0) {
    return jsonError(c, 404, "NOT_FOUND", "No row matched the key");
  }
  return c.json({ ok: true, auth_mode: c.get("adminAuthState")?.mode ?? null, deleted: true });
});

// src/routes/admin.ts
var adminRoutes = new Hono2();
adminRoutes.use("*", async (c, next) => {
  withNoStore(c);
  await next();
});
adminRoutes.use("*", requireAdmin());
adminRoutes.route("/", adminConfigRoutes);
adminRoutes.route("/", adminDbRoutes);
adminRoutes.get("/runs", async (c) => {
  const limit = Number(c.req.query("limit") || 25);
  const runs = await listRunReports(c.env.DB, limit);
  return c.json({
    ok: true,
    count: runs.length,
    auth_mode: c.get("adminAuthState")?.mode || null,
    runs
  });
});
adminRoutes.get("/runs/:runId", async (c) => {
  const runId = c.req.param("runId");
  const run = await getRunReport(c.env.DB, runId);
  if (!run) {
    return jsonError(c, 404, "NOT_FOUND", `Run report not found: ${runId}`);
  }
  return c.json({
    ok: true,
    auth_mode: c.get("adminAuthState")?.mode || null,
    run
  });
});
adminRoutes.post("/runs/daily", async (c) => {
  log2.info("admin", "Manual daily run triggered");
  const body = await c.req.json().catch(() => ({}));
  const force = Boolean(body.force);
  const result = await triggerDailyRun(c.env, {
    source: "manual",
    force
  });
  return c.json({
    ok: true,
    auth_mode: c.get("adminAuthState")?.mode || null,
    result
  });
});
adminRoutes.post("/runs/backfill", async (c) => {
  log2.info("admin", "Manual backfill run triggered");
  const body = await c.req.json().catch(() => ({}));
  const rawLenderCodes = body.lenderCodes;
  const lenderCodes = Array.isArray(rawLenderCodes) ? rawLenderCodes.map((x) => String(x || "").trim()).filter(Boolean) : void 0;
  const monthCursor = typeof body.monthCursor === "string" ? body.monthCursor : void 0;
  const maxSnapshotsPerMonth = Number(body.maxSnapshotsPerMonth || 3);
  const result = await triggerBackfillRun(c.env, {
    lenderCodes,
    monthCursor,
    maxSnapshotsPerMonth
  });
  return c.json({
    ok: true,
    auth_mode: c.get("adminAuthState")?.mode || null,
    result
  });
});

// src/db/queries.ts
var VALID_ORDER_BY = {
  default: "v.collection_date DESC, v.bank_name ASC, v.product_name ASC, v.lvr_tier ASC, v.rate_structure ASC",
  rate_asc: "v.interest_rate ASC, v.bank_name ASC, v.product_name ASC",
  rate_desc: "v.interest_rate DESC, v.bank_name ASC, v.product_name ASC"
};
var MIN_PUBLIC_RATE = 0.5;
var MAX_PUBLIC_RATE = 25;
var MIN_CONFIDENCE_ALL = 0.85;
var MIN_CONFIDENCE_DAILY = 0.9;
var MIN_CONFIDENCE_HISTORICAL = 0.82;
function safeLimit(limit, fallback, max = 500) {
  if (!Number.isFinite(limit)) {
    return fallback;
  }
  return Math.min(max, Math.max(1, Math.floor(limit)));
}
__name(safeLimit, "safeLimit");
function rows(result) {
  return result.results ?? [];
}
__name(rows, "rows");
async function getFilters(db) {
  const [banks, securityPurposes, repaymentTypes, rateStructures, lvrTiers, featureSets] = await Promise.all([
    db.prepare("SELECT DISTINCT bank_name AS value FROM historical_loan_rates ORDER BY bank_name ASC").all(),
    db.prepare("SELECT DISTINCT security_purpose AS value FROM historical_loan_rates ORDER BY security_purpose ASC").all(),
    db.prepare("SELECT DISTINCT repayment_type AS value FROM historical_loan_rates ORDER BY repayment_type ASC").all(),
    db.prepare("SELECT DISTINCT rate_structure AS value FROM historical_loan_rates ORDER BY rate_structure ASC").all(),
    db.prepare("SELECT DISTINCT lvr_tier AS value FROM historical_loan_rates ORDER BY lvr_tier ASC").all(),
    db.prepare("SELECT DISTINCT feature_set AS value FROM historical_loan_rates ORDER BY feature_set ASC").all()
  ]);
  const fallbackIfEmpty = /* @__PURE__ */ __name((values, fallback) => values.length > 0 ? values : fallback, "fallbackIfEmpty");
  return {
    banks: rows(banks).map((x) => x.value),
    security_purposes: fallbackIfEmpty(
      rows(securityPurposes).map((x) => x.value),
      SECURITY_PURPOSES
    ),
    repayment_types: fallbackIfEmpty(
      rows(repaymentTypes).map((x) => x.value),
      REPAYMENT_TYPES
    ),
    rate_structures: fallbackIfEmpty(
      rows(rateStructures).map((x) => x.value),
      RATE_STRUCTURES
    ),
    lvr_tiers: fallbackIfEmpty(
      rows(lvrTiers).map((x) => x.value),
      LVR_TIERS
    ),
    feature_sets: fallbackIfEmpty(
      rows(featureSets).map((x) => x.value),
      FEATURE_SETS
    )
  };
}
__name(getFilters, "getFilters");
async function queryLatestRates(db, filters) {
  const where = [];
  const binds = [];
  where.push("v.interest_rate BETWEEN ? AND ?");
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE);
  if (filters.bank) {
    where.push("v.bank_name = ?");
    binds.push(filters.bank);
  }
  if (filters.securityPurpose) {
    where.push("v.security_purpose = ?");
    binds.push(filters.securityPurpose);
  }
  if (filters.repaymentType) {
    where.push("v.repayment_type = ?");
    binds.push(filters.repaymentType);
  }
  if (filters.rateStructure) {
    where.push("v.rate_structure = ?");
    binds.push(filters.rateStructure);
  }
  if (filters.lvrTier) {
    where.push("v.lvr_tier = ?");
    binds.push(filters.lvrTier);
  }
  if (filters.featureSet) {
    where.push("v.feature_set = ?");
    binds.push(filters.featureSet);
  }
  if (filters.mode === "daily") {
    where.push("v.data_quality_flag NOT LIKE 'parsed_from_wayback%'");
    where.push("v.confidence_score >= ?");
    binds.push(MIN_CONFIDENCE_DAILY);
  } else if (filters.mode === "historical") {
    where.push("v.data_quality_flag LIKE 'parsed_from_wayback%'");
    where.push("v.confidence_score >= ?");
    binds.push(MIN_CONFIDENCE_HISTORICAL);
  } else {
    where.push("v.confidence_score >= ?");
    binds.push(MIN_CONFIDENCE_ALL);
  }
  const limit = safeLimit(filters.limit, 200, 1e3);
  binds.push(limit);
  const sql = `
    SELECT
      v.bank_name,
      v.collection_date,
      v.product_id,
      v.product_name,
      v.security_purpose,
      v.repayment_type,
      v.rate_structure,
      v.lvr_tier,
      v.feature_set,
      v.interest_rate,
      v.comparison_rate,
      v.annual_fee,
      v.source_url,
      v.data_quality_flag,
      v.confidence_score,
      v.parsed_at,
      v.product_key,
      r.cash_rate AS rba_cash_rate
    FROM vw_latest_rates v
    LEFT JOIN rba_cash_rates r
      ON r.collection_date = v.collection_date
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY ${VALID_ORDER_BY[filters.orderBy ?? "default"] ?? VALID_ORDER_BY.default}
    LIMIT ?
  `;
  const result = await db.prepare(sql).bind(...binds).all();
  return rows(result);
}
__name(queryLatestRates, "queryLatestRates");
async function queryTimeseries(db, input) {
  const where = [];
  const binds = [];
  where.push("t.interest_rate BETWEEN ? AND ?");
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE);
  if (input.bank) {
    where.push("t.bank_name = ?");
    binds.push(input.bank);
  }
  if (input.productKey) {
    where.push("t.product_key = ?");
    binds.push(input.productKey);
  }
  if (input.securityPurpose) {
    where.push("t.security_purpose = ?");
    binds.push(input.securityPurpose);
  }
  if (input.repaymentType) {
    where.push("t.repayment_type = ?");
    binds.push(input.repaymentType);
  }
  if (input.featureSet) {
    where.push("t.feature_set = ?");
    binds.push(input.featureSet);
  }
  if (input.startDate) {
    where.push("t.collection_date >= ?");
    binds.push(input.startDate);
  }
  if (input.endDate) {
    where.push("t.collection_date <= ?");
    binds.push(input.endDate);
  }
  if (input.mode === "daily") {
    where.push("t.data_quality_flag NOT LIKE 'parsed_from_wayback%'");
    where.push("t.confidence_score >= ?");
    binds.push(MIN_CONFIDENCE_DAILY);
  } else if (input.mode === "historical") {
    where.push("t.data_quality_flag LIKE 'parsed_from_wayback%'");
    where.push("t.confidence_score >= ?");
    binds.push(MIN_CONFIDENCE_HISTORICAL);
  } else {
    where.push("t.confidence_score >= ?");
    binds.push(MIN_CONFIDENCE_ALL);
  }
  const limit = safeLimit(input.limit, 500, 5e3);
  binds.push(limit);
  const sql = `
    SELECT
      t.collection_date,
      t.bank_name,
      t.product_id,
      t.product_name,
      t.security_purpose,
      t.repayment_type,
      t.lvr_tier,
      t.rate_structure,
      t.feature_set,
      t.interest_rate,
      t.comparison_rate,
      t.annual_fee,
      t.data_quality_flag,
      t.confidence_score,
      t.source_url,
      t.product_key,
      r.cash_rate AS rba_cash_rate
    FROM vw_rate_timeseries t
    LEFT JOIN rba_cash_rates r
      ON r.collection_date = t.collection_date
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY t.collection_date ASC
    LIMIT ?
  `;
  const result = await db.prepare(sql).bind(...binds).all();
  return rows(result);
}
__name(queryTimeseries, "queryTimeseries");
var PAGINATED_SORT_COLUMNS = {
  collection_date: "h.collection_date",
  bank_name: "h.bank_name",
  product_name: "h.product_name",
  security_purpose: "h.security_purpose",
  repayment_type: "h.repayment_type",
  rate_structure: "h.rate_structure",
  lvr_tier: "h.lvr_tier",
  feature_set: "h.feature_set",
  interest_rate: "h.interest_rate",
  comparison_rate: "h.comparison_rate",
  annual_fee: "h.annual_fee",
  rba_cash_rate: "rba_cash_rate",
  parsed_at: "h.parsed_at",
  run_source: "h.run_source",
  source_url: "h.source_url"
};
async function queryRatesPaginated(db, filters) {
  const where = [];
  const binds = [];
  where.push("h.interest_rate BETWEEN ? AND ?");
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE);
  where.push("h.confidence_score >= ?");
  binds.push(MIN_CONFIDENCE_ALL);
  if (!filters.includeManual) {
    where.push("(h.run_source IS NULL OR h.run_source != 'manual')");
  }
  if (filters.bank) {
    where.push("h.bank_name = ?");
    binds.push(filters.bank);
  }
  if (filters.securityPurpose) {
    where.push("h.security_purpose = ?");
    binds.push(filters.securityPurpose);
  }
  if (filters.repaymentType) {
    where.push("h.repayment_type = ?");
    binds.push(filters.repaymentType);
  }
  if (filters.rateStructure) {
    where.push("h.rate_structure = ?");
    binds.push(filters.rateStructure);
  }
  if (filters.lvrTier) {
    where.push("h.lvr_tier = ?");
    binds.push(filters.lvrTier);
  }
  if (filters.featureSet) {
    where.push("h.feature_set = ?");
    binds.push(filters.featureSet);
  }
  if (filters.startDate) {
    where.push("h.collection_date >= ?");
    binds.push(filters.startDate);
  }
  if (filters.endDate) {
    where.push("h.collection_date <= ?");
    binds.push(filters.endDate);
  }
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sortCol = PAGINATED_SORT_COLUMNS[filters.sort ?? ""] ?? "h.collection_date";
  const sortDir = filters.dir === "desc" ? "DESC" : "ASC";
  const orderClause = `ORDER BY ${sortCol} ${sortDir}, h.bank_name ASC, h.product_name ASC`;
  const page = Math.max(1, Math.floor(Number(filters.page) || 1));
  const size = Math.min(500, Math.max(1, Math.floor(Number(filters.size) || 50)));
  const offset = (page - 1) * size;
  const countSql = `SELECT COUNT(*) AS total FROM historical_loan_rates h ${whereClause}`;
  const dataSql = `
    SELECT
      h.bank_name,
      h.collection_date,
      h.product_id,
      h.product_name,
      h.security_purpose,
      h.repayment_type,
      h.rate_structure,
      h.lvr_tier,
      h.feature_set,
      h.interest_rate,
      h.comparison_rate,
      h.annual_fee,
      h.source_url,
      h.data_quality_flag,
      h.confidence_score,
      h.parsed_at,
      h.run_id,
      h.run_source,
      h.bank_name || '|' || h.product_id || '|' || h.security_purpose || '|' || h.repayment_type || '|' || h.lvr_tier || '|' || h.rate_structure AS product_key,
      r.cash_rate AS rba_cash_rate
    FROM historical_loan_rates h
    LEFT JOIN rba_cash_rates r
      ON r.collection_date = h.collection_date
    ${whereClause}
    ${orderClause}
    LIMIT ? OFFSET ?
  `;
  const dataBinds = [...binds, size, offset];
  const [countResult, dataResult] = await Promise.all([
    db.prepare(countSql).bind(...binds).first(),
    db.prepare(dataSql).bind(...dataBinds).all()
  ]);
  const total = Number(countResult?.total ?? 0);
  const lastPage = Math.max(1, Math.ceil(total / size));
  return {
    last_page: lastPage,
    total,
    data: rows(dataResult)
  };
}
__name(queryRatesPaginated, "queryRatesPaginated");
var EXPORT_MAX_ROWS = 1e4;
async function queryRatesForExport(db, filters, maxRows = EXPORT_MAX_ROWS) {
  const where = [];
  const binds = [];
  where.push("h.interest_rate BETWEEN ? AND ?");
  binds.push(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE);
  where.push("h.confidence_score >= ?");
  binds.push(MIN_CONFIDENCE_ALL);
  if (!filters.includeManual) {
    where.push("(h.run_source IS NULL OR h.run_source != 'manual')");
  }
  if (filters.bank) {
    where.push("h.bank_name = ?");
    binds.push(filters.bank);
  }
  if (filters.securityPurpose) {
    where.push("h.security_purpose = ?");
    binds.push(filters.securityPurpose);
  }
  if (filters.repaymentType) {
    where.push("h.repayment_type = ?");
    binds.push(filters.repaymentType);
  }
  if (filters.rateStructure) {
    where.push("h.rate_structure = ?");
    binds.push(filters.rateStructure);
  }
  if (filters.lvrTier) {
    where.push("h.lvr_tier = ?");
    binds.push(filters.lvrTier);
  }
  if (filters.featureSet) {
    where.push("h.feature_set = ?");
    binds.push(filters.featureSet);
  }
  if (filters.startDate) {
    where.push("h.collection_date >= ?");
    binds.push(filters.startDate);
  }
  if (filters.endDate) {
    where.push("h.collection_date <= ?");
    binds.push(filters.endDate);
  }
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sortCol = PAGINATED_SORT_COLUMNS[filters.sort ?? ""] ?? "h.collection_date";
  const sortDir = filters.dir === "desc" ? "DESC" : "ASC";
  const orderClause = `ORDER BY ${sortCol} ${sortDir}, h.bank_name ASC, h.product_name ASC`;
  const limit = Math.min(maxRows, Math.max(1, Math.floor(Number(filters.limit) || maxRows)));
  const countSql = `SELECT COUNT(*) AS total FROM historical_loan_rates h ${whereClause}`;
  const dataSql = `
    SELECT
      h.bank_name,
      h.collection_date,
      h.product_id,
      h.product_name,
      h.security_purpose,
      h.repayment_type,
      h.rate_structure,
      h.lvr_tier,
      h.feature_set,
      h.interest_rate,
      h.comparison_rate,
      h.annual_fee,
      h.source_url,
      h.data_quality_flag,
      h.confidence_score,
      h.parsed_at,
      h.run_id,
      h.run_source,
      h.bank_name || '|' || h.product_id || '|' || h.security_purpose || '|' || h.repayment_type || '|' || h.lvr_tier || '|' || h.rate_structure AS product_key,
      r.cash_rate AS rba_cash_rate
    FROM historical_loan_rates h
    LEFT JOIN rba_cash_rates r
      ON r.collection_date = h.collection_date
    ${whereClause}
    ${orderClause}
    LIMIT ?
  `;
  const [countResult, dataResult] = await Promise.all([
    db.prepare(countSql).bind(...binds).first(),
    db.prepare(dataSql).bind(...binds, limit).all()
  ]);
  const total = Number(countResult?.total ?? 0);
  return {
    data: rows(dataResult),
    total
  };
}
__name(queryRatesForExport, "queryRatesForExport");
async function getLenderStaleness(db, staleHours = 48) {
  const result = await db.prepare(
    `SELECT
        bank_name,
        MAX(collection_date) AS latest_date,
        MAX(parsed_at) AS latest_parsed_at,
        COUNT(*) AS total_rows
       FROM historical_loan_rates
       GROUP BY bank_name
       ORDER BY bank_name ASC`
  ).all();
  const now = Date.now();
  return rows(result).map((r) => {
    const parsedAt = new Date(r.latest_parsed_at).getTime();
    const ageMs = now - parsedAt;
    const ageHours = Math.round(ageMs / (1e3 * 60 * 60));
    return {
      bank_name: r.bank_name,
      latest_date: r.latest_date,
      latest_parsed_at: r.latest_parsed_at,
      total_rows: Number(r.total_rows),
      age_hours: ageHours,
      stale: ageHours > staleHours
    };
  });
}
__name(getLenderStaleness, "getLenderStaleness");
async function getQualityDiagnostics(db) {
  const [totals, byFlag] = await Promise.all([
    db.prepare(
      `SELECT
          COUNT(*) AS total_rows,
          SUM(CASE WHEN interest_rate BETWEEN ? AND ? THEN 1 ELSE 0 END) AS in_range_rows,
          SUM(CASE WHEN confidence_score >= ? THEN 1 ELSE 0 END) AS confidence_ok_rows
         FROM historical_loan_rates`
    ).bind(MIN_PUBLIC_RATE, MAX_PUBLIC_RATE, MIN_CONFIDENCE_ALL).first(),
    db.prepare(
      `SELECT data_quality_flag, COUNT(*) AS n
         FROM historical_loan_rates
         GROUP BY data_quality_flag
         ORDER BY n DESC`
    ).all()
  ]);
  return {
    total_rows: Number(totals?.total_rows ?? 0),
    in_range_rows: Number(totals?.in_range_rows ?? 0),
    confidence_ok_rows: Number(totals?.confidence_ok_rows ?? 0),
    by_flag: rows(byFlag).map((x) => ({
      data_quality_flag: x.data_quality_flag,
      count: Number(x.n)
    }))
  };
}
__name(getQualityDiagnostics, "getQualityDiagnostics");

// src/routes/public.ts
var publicRoutes = new Hono2();
publicRoutes.use("*", async (c, next) => {
  withPublicCache(c, DEFAULT_PUBLIC_CACHE_SECONDS);
  await next();
});
publicRoutes.get("/health", async (c) => {
  withPublicCache(c, 30);
  const melbourne = getMelbourneNowParts(/* @__PURE__ */ new Date(), c.env.MELBOURNE_TIMEZONE || MELBOURNE_TIMEZONE);
  const targetHour = parseIntegerEnv(c.env.MELBOURNE_TARGET_HOUR, 6);
  return c.json({
    ok: true,
    service: "australianrates-api",
    phase: "phase1",
    version: c.env.WORKER_VERSION || "dev",
    api_base_path: c.env.PUBLIC_API_BASE_PATH || API_BASE_PATH,
    melbourne,
    scheduled_target_hour: targetHour,
    features: {
      prospective: String(c.env.FEATURE_PROSPECTIVE_ENABLED || "true").toLowerCase() === "true",
      backfill: String(c.env.FEATURE_BACKFILL_ENABLED || "true").toLowerCase() === "true"
    },
    bindings: {
      db: Boolean(c.env.DB),
      raw_bucket: Boolean(c.env.RAW_BUCKET),
      ingest_queue: Boolean(c.env.INGEST_QUEUE),
      run_lock_do: Boolean(c.env.RUN_LOCK_DO)
    }
  });
});
publicRoutes.get("/staleness", async (c) => {
  withPublicCache(c, 60);
  const staleness = await getLenderStaleness(c.env.DB);
  const staleLenders = staleness.filter((l) => l.stale);
  return c.json({
    ok: true,
    stale_count: staleLenders.length,
    lenders: staleness
  });
});
publicRoutes.post("/trigger-run", async (c) => {
  const DEFAULT_COOLDOWN_SECONDS = 0;
  const cooldownSeconds = parseIntegerEnv(c.env.MANUAL_RUN_COOLDOWN_SECONDS, DEFAULT_COOLDOWN_SECONDS);
  const cooldownMs = cooldownSeconds * 1e3;
  if (cooldownMs > 0) {
    const lastStartedAt = await getLastManualRunStartedAt(c.env.DB);
    if (lastStartedAt) {
      const lastMs = new Date(lastStartedAt.endsWith("Z") ? lastStartedAt : lastStartedAt.trim() + "Z").getTime();
      const elapsed = Number.isNaN(lastMs) ? cooldownMs : Date.now() - lastMs;
      if (elapsed >= 0 && elapsed < cooldownMs) {
        const retryAfter = Math.ceil((cooldownMs - elapsed) / 1e3);
        return c.json(
          { ok: false, reason: "rate_limited", retry_after_seconds: retryAfter },
          429
        );
      }
    }
  }
  log2.info("api", "Public manual run triggered");
  const result = await triggerDailyRun(c.env, { source: "manual", force: true });
  return c.json({ ok: true, result });
});
publicRoutes.get("/filters", async (c) => {
  const filters = await getFilters(c.env.DB);
  return c.json({
    ok: true,
    filters
  });
});
publicRoutes.get("/quality/diagnostics", async (c) => {
  const diagnostics = await getQualityDiagnostics(c.env.DB);
  return c.json({
    ok: true,
    diagnostics
  });
});
publicRoutes.get("/rates", async (c) => {
  const query = c.req.query();
  const dir = String(query.dir || "desc").toLowerCase();
  const includeManual = query.include_manual === "true" || query.include_manual === "1";
  const result = await queryRatesPaginated(c.env.DB, {
    page: Number(query.page || 1),
    size: Number(query.size || 50),
    startDate: query.start_date,
    endDate: query.end_date,
    bank: query.bank,
    securityPurpose: query.security_purpose,
    repaymentType: query.repayment_type,
    rateStructure: query.rate_structure,
    lvrTier: query.lvr_tier,
    featureSet: query.feature_set,
    sort: query.sort,
    dir: dir === "asc" || dir === "desc" ? dir : "desc",
    includeManual
  });
  return c.json(result);
});
publicRoutes.get("/export", async (c) => {
  const query = c.req.query();
  const format = String(query.format || "json").toLowerCase();
  if (format !== "csv" && format !== "json") {
    return jsonError(c, 400, "INVALID_FORMAT", "format must be csv or json");
  }
  const dir = String(query.dir || "desc").toLowerCase();
  const includeManual = query.include_manual === "true" || query.include_manual === "1";
  const { data, total } = await queryRatesForExport(c.env.DB, {
    startDate: query.start_date,
    endDate: query.end_date,
    bank: query.bank,
    securityPurpose: query.security_purpose,
    repaymentType: query.repayment_type,
    rateStructure: query.rate_structure,
    lvrTier: query.lvr_tier,
    featureSet: query.feature_set,
    sort: query.sort,
    dir: dir === "asc" || dir === "desc" ? dir : "desc",
    includeManual,
    limit: 1e4
  });
  if (format === "csv") {
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", 'attachment; filename="rates-export.csv"');
    return c.body(toCsv(data));
  }
  c.header("Content-Type", "application/json; charset=utf-8");
  c.header("Content-Disposition", 'attachment; filename="rates-export.json"');
  return c.json({ data, total, last_page: 1 });
});
publicRoutes.get("/latest", async (c) => {
  const query = c.req.query();
  const limit = Number(query.limit || 200);
  const modeRaw = String(query.mode || "all").toLowerCase();
  const mode = modeRaw === "daily" || modeRaw === "historical" ? modeRaw : "all";
  const orderByRaw = String(query.order_by || query.orderBy || "default").toLowerCase();
  const orderBy = orderByRaw === "rate_asc" || orderByRaw === "rate_desc" ? orderByRaw : "default";
  const rows4 = await queryLatestRates(c.env.DB, {
    bank: query.bank,
    securityPurpose: query.security_purpose,
    repaymentType: query.repayment_type,
    rateStructure: query.rate_structure,
    lvrTier: query.lvr_tier,
    featureSet: query.feature_set,
    mode,
    limit,
    orderBy
  });
  return c.json({
    ok: true,
    count: rows4.length,
    rows: rows4
  });
});
publicRoutes.get("/timeseries", async (c) => {
  const query = c.req.query();
  const productKey = query.product_key || query.productKey;
  const modeRaw = String(query.mode || "all").toLowerCase();
  const mode = modeRaw === "daily" || modeRaw === "historical" ? modeRaw : "all";
  if (!productKey) {
    return jsonError(c, 400, "INVALID_REQUEST", "product_key is required for timeseries queries.");
  }
  const rows4 = await queryTimeseries(c.env.DB, {
    bank: query.bank,
    productKey,
    securityPurpose: query.security_purpose,
    repaymentType: query.repayment_type,
    featureSet: query.feature_set,
    mode,
    startDate: query.start_date,
    endDate: query.end_date,
    limit: Number(query.limit || 1e3)
  });
  return c.json({
    ok: true,
    count: rows4.length,
    rows: rows4
  });
});
publicRoutes.get("/logs/stats", async (c) => {
  withPublicCache(c, 30);
  const stats = await getLogStats(c.env.DB);
  return c.json({ ok: true, ...stats });
});
publicRoutes.get("/logs", async (c) => {
  withPublicCache(c, 15);
  const query = c.req.query();
  const level = query.level;
  const source = query.source;
  const limit = Number(query.limit || 5e3);
  const offset = Number(query.offset || 0);
  const format = String(query.format || "text").toLowerCase();
  const { entries, total } = await queryLogs(c.env.DB, { level, source, limit, offset });
  if (format === "json") {
    return c.json({ ok: true, total, count: entries.length, entries });
  }
  const lines = entries.map((e) => {
    const parts = [
      String(e.ts ?? ""),
      `[${String(e.level ?? "info").toUpperCase()}]`,
      `[${String(e.source ?? "api")}]`,
      String(e.message ?? "")
    ];
    if (e.run_id) parts.push(`run=${e.run_id}`);
    if (e.lender_code) parts.push(`lender=${e.lender_code}`);
    if (e.context) parts.push(String(e.context));
    return parts.join(" ");
  });
  c.header("Content-Type", "text/plain; charset=utf-8");
  c.header("Content-Disposition", 'attachment; filename="australianrates-log.txt"');
  return c.body(`# AustralianRates Global Log (${total} entries total, showing ${entries.length})
# Downloaded at ${(/* @__PURE__ */ new Date()).toISOString()}

${lines.join("\n")}
`);
});
function csvEscape(value) {
  if (value == null) return "";
  const raw2 = String(value);
  if (/[",\n\r]/.test(raw2)) {
    return `"${raw2.replace(/"/g, '""')}"`;
  }
  return raw2;
}
__name(csvEscape, "csvEscape");
function toCsv(rows4) {
  if (rows4.length === 0) {
    return "";
  }
  const headers = Object.keys(rows4[0]);
  const lines = [headers.join(",")];
  for (const row of rows4) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  return lines.join("\n");
}
__name(toCsv, "toCsv");
publicRoutes.get("/export.csv", async (c) => {
  const query = c.req.query();
  const dataset = String(query.dataset || "latest").toLowerCase();
  const modeRaw = String(query.mode || "all").toLowerCase();
  const mode = modeRaw === "daily" || modeRaw === "historical" ? modeRaw : "all";
  if (dataset === "timeseries") {
    const productKey = query.product_key || query.productKey;
    if (!productKey) {
      return jsonError(c, 400, "INVALID_REQUEST", "product_key is required for timeseries CSV export.");
    }
    const rows5 = await queryTimeseries(c.env.DB, {
      bank: query.bank,
      productKey,
      securityPurpose: query.security_purpose,
      repaymentType: query.repayment_type,
      featureSet: query.feature_set,
      mode,
      startDate: query.start_date,
      endDate: query.end_date,
      limit: Number(query.limit || 5e3)
    });
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="timeseries-${mode}.csv"`);
    return c.body(toCsv(rows5));
  }
  const rows4 = await queryLatestRates(c.env.DB, {
    bank: query.bank,
    securityPurpose: query.security_purpose,
    repaymentType: query.repayment_type,
    rateStructure: query.rate_structure,
    lvrTier: query.lvr_tier,
    featureSet: query.feature_set,
    mode,
    limit: Number(query.limit || 1e3)
  });
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="latest-${mode}.csv"`);
  return c.body(toCsv(rows4));
});

// src/db/savings-queries.ts
var MIN_PUBLIC_RATE2 = 0;
var MAX_PUBLIC_RATE2 = 15;
var MIN_CONFIDENCE = 0.85;
function safeLimit2(limit, fallback, max = 500) {
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(limit)));
}
__name(safeLimit2, "safeLimit");
function rows2(result) {
  return result.results ?? [];
}
__name(rows2, "rows");
async function getSavingsFilters(db) {
  const [banks, accountTypes, rateTypes, depositTiers] = await Promise.all([
    db.prepare("SELECT DISTINCT bank_name AS value FROM historical_savings_rates ORDER BY bank_name ASC").all(),
    db.prepare("SELECT DISTINCT account_type AS value FROM historical_savings_rates ORDER BY account_type ASC").all(),
    db.prepare("SELECT DISTINCT rate_type AS value FROM historical_savings_rates ORDER BY rate_type ASC").all(),
    db.prepare("SELECT DISTINCT deposit_tier AS value FROM historical_savings_rates ORDER BY deposit_tier ASC").all()
  ]);
  const fallback = /* @__PURE__ */ __name((vals, fb) => vals.length > 0 ? vals : fb, "fallback");
  return {
    banks: rows2(banks).map((x) => x.value),
    account_types: fallback(rows2(accountTypes).map((x) => x.value), SAVINGS_ACCOUNT_TYPES),
    rate_types: fallback(rows2(rateTypes).map((x) => x.value), SAVINGS_RATE_TYPES),
    deposit_tiers: rows2(depositTiers).map((x) => x.value)
  };
}
__name(getSavingsFilters, "getSavingsFilters");
var SORT_COLUMNS = {
  collection_date: "h.collection_date",
  bank_name: "h.bank_name",
  product_name: "h.product_name",
  account_type: "h.account_type",
  rate_type: "h.rate_type",
  interest_rate: "h.interest_rate",
  deposit_tier: "h.deposit_tier",
  monthly_fee: "h.monthly_fee",
  parsed_at: "h.parsed_at",
  run_source: "h.run_source"
};
function buildWhere(filters) {
  const where = [];
  const binds = [];
  where.push("h.interest_rate BETWEEN ? AND ?");
  binds.push(MIN_PUBLIC_RATE2, MAX_PUBLIC_RATE2);
  where.push("h.confidence_score >= ?");
  binds.push(MIN_CONFIDENCE);
  if (!filters.includeManual) where.push("(h.run_source IS NULL OR h.run_source != 'manual')");
  if (filters.bank) {
    where.push("h.bank_name = ?");
    binds.push(filters.bank);
  }
  if (filters.accountType) {
    where.push("h.account_type = ?");
    binds.push(filters.accountType);
  }
  if (filters.rateType) {
    where.push("h.rate_type = ?");
    binds.push(filters.rateType);
  }
  if (filters.depositTier) {
    where.push("h.deposit_tier = ?");
    binds.push(filters.depositTier);
  }
  if (filters.startDate) {
    where.push("h.collection_date >= ?");
    binds.push(filters.startDate);
  }
  if (filters.endDate) {
    where.push("h.collection_date <= ?");
    binds.push(filters.endDate);
  }
  return { clause: where.length ? `WHERE ${where.join(" AND ")}` : "", binds };
}
__name(buildWhere, "buildWhere");
async function querySavingsRatesPaginated(db, filters) {
  const { clause: whereClause, binds } = buildWhere(filters);
  const sortCol = SORT_COLUMNS[filters.sort ?? ""] ?? "h.collection_date";
  const sortDir = filters.dir === "desc" ? "DESC" : "ASC";
  const orderClause = `ORDER BY ${sortCol} ${sortDir}, h.bank_name ASC, h.product_name ASC`;
  const page = Math.max(1, Math.floor(Number(filters.page) || 1));
  const size = Math.min(500, Math.max(1, Math.floor(Number(filters.size) || 50)));
  const offset = (page - 1) * size;
  const countSql = `SELECT COUNT(*) AS total FROM historical_savings_rates h ${whereClause}`;
  const dataSql = `
    SELECT
      h.bank_name, h.collection_date, h.product_id, h.product_name,
      h.account_type, h.rate_type, h.interest_rate, h.deposit_tier,
      h.min_balance, h.max_balance, h.conditions, h.monthly_fee,
      h.source_url, h.data_quality_flag, h.confidence_score,
      h.parsed_at, h.run_id, h.run_source,
      h.bank_name || '|' || h.product_id || '|' || h.account_type || '|' || h.rate_type || '|' || h.deposit_tier AS product_key
    FROM historical_savings_rates h
    ${whereClause} ${orderClause}
    LIMIT ? OFFSET ?
  `;
  const [countResult, dataResult] = await Promise.all([
    db.prepare(countSql).bind(...binds).first(),
    db.prepare(dataSql).bind(...binds, size, offset).all()
  ]);
  const total = Number(countResult?.total ?? 0);
  return { last_page: Math.max(1, Math.ceil(total / size)), total, data: rows2(dataResult) };
}
__name(querySavingsRatesPaginated, "querySavingsRatesPaginated");
async function queryLatestSavingsRates(db, filters) {
  const where = [];
  const binds = [];
  where.push("v.interest_rate BETWEEN ? AND ?");
  binds.push(MIN_PUBLIC_RATE2, MAX_PUBLIC_RATE2);
  where.push("v.confidence_score >= ?");
  binds.push(MIN_CONFIDENCE);
  if (filters.bank) {
    where.push("v.bank_name = ?");
    binds.push(filters.bank);
  }
  if (filters.accountType) {
    where.push("v.account_type = ?");
    binds.push(filters.accountType);
  }
  if (filters.rateType) {
    where.push("v.rate_type = ?");
    binds.push(filters.rateType);
  }
  if (filters.depositTier) {
    where.push("v.deposit_tier = ?");
    binds.push(filters.depositTier);
  }
  const orderMap = {
    default: "v.collection_date DESC, v.bank_name ASC, v.product_name ASC",
    rate_asc: "v.interest_rate ASC, v.bank_name ASC",
    rate_desc: "v.interest_rate DESC, v.bank_name ASC"
  };
  const limit = safeLimit2(filters.limit, 200, 1e3);
  binds.push(limit);
  const sql = `
    SELECT v.*, v.product_key
    FROM vw_latest_savings_rates v
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY ${orderMap[filters.orderBy ?? "default"] ?? orderMap.default}
    LIMIT ?
  `;
  const result = await db.prepare(sql).bind(...binds).all();
  return rows2(result);
}
__name(queryLatestSavingsRates, "queryLatestSavingsRates");
async function querySavingsTimeseries(db, input) {
  const where = [];
  const binds = [];
  where.push("t.interest_rate BETWEEN ? AND ?");
  binds.push(MIN_PUBLIC_RATE2, MAX_PUBLIC_RATE2);
  where.push("t.confidence_score >= ?");
  binds.push(MIN_CONFIDENCE);
  if (input.bank) {
    where.push("t.bank_name = ?");
    binds.push(input.bank);
  }
  if (input.productKey) {
    where.push("t.product_key = ?");
    binds.push(input.productKey);
  }
  if (input.accountType) {
    where.push("t.account_type = ?");
    binds.push(input.accountType);
  }
  if (input.rateType) {
    where.push("t.rate_type = ?");
    binds.push(input.rateType);
  }
  if (input.startDate) {
    where.push("t.collection_date >= ?");
    binds.push(input.startDate);
  }
  if (input.endDate) {
    where.push("t.collection_date <= ?");
    binds.push(input.endDate);
  }
  const limit = safeLimit2(input.limit, 500, 5e3);
  binds.push(limit);
  const sql = `
    SELECT t.*
    FROM vw_savings_timeseries t
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY t.collection_date ASC
    LIMIT ?
  `;
  const result = await db.prepare(sql).bind(...binds).all();
  return rows2(result);
}
__name(querySavingsTimeseries, "querySavingsTimeseries");
async function querySavingsForExport(db, filters, maxRows = 1e4) {
  const { clause: whereClause, binds } = buildWhere(filters);
  const sortCol = SORT_COLUMNS[filters.sort ?? ""] ?? "h.collection_date";
  const sortDir = filters.dir === "desc" ? "DESC" : "ASC";
  const limit = Math.min(maxRows, Math.max(1, Math.floor(Number(maxRows))));
  const countSql = `SELECT COUNT(*) AS total FROM historical_savings_rates h ${whereClause}`;
  const dataSql = `
    SELECT
      h.bank_name, h.collection_date, h.product_id, h.product_name,
      h.account_type, h.rate_type, h.interest_rate, h.deposit_tier,
      h.min_balance, h.max_balance, h.conditions, h.monthly_fee,
      h.source_url, h.data_quality_flag, h.confidence_score,
      h.parsed_at, h.run_id, h.run_source,
      h.bank_name || '|' || h.product_id || '|' || h.account_type || '|' || h.rate_type || '|' || h.deposit_tier AS product_key
    FROM historical_savings_rates h
    ${whereClause}
    ORDER BY ${sortCol} ${sortDir}, h.bank_name ASC, h.product_name ASC
    LIMIT ?
  `;
  const [countResult, dataResult] = await Promise.all([
    db.prepare(countSql).bind(...binds).first(),
    db.prepare(dataSql).bind(...binds, limit).all()
  ]);
  return { data: rows2(dataResult), total: Number(countResult?.total ?? 0) };
}
__name(querySavingsForExport, "querySavingsForExport");

// src/routes/savings-public.ts
var savingsPublicRoutes = new Hono2();
savingsPublicRoutes.use("*", async (c, next) => {
  withPublicCache(c, DEFAULT_PUBLIC_CACHE_SECONDS);
  await next();
});
savingsPublicRoutes.get("/health", (c) => {
  withPublicCache(c, 30);
  return c.json({ ok: true, service: "australianrates-savings" });
});
savingsPublicRoutes.post("/trigger-run", async (c) => {
  const DEFAULT_COOLDOWN_SECONDS = 0;
  const cooldownSeconds = parseIntegerEnv(c.env.MANUAL_RUN_COOLDOWN_SECONDS, DEFAULT_COOLDOWN_SECONDS);
  const cooldownMs = cooldownSeconds * 1e3;
  if (cooldownMs > 0) {
    const lastStartedAt = await getLastManualRunStartedAt(c.env.DB);
    if (lastStartedAt) {
      const lastMs = new Date(lastStartedAt.endsWith("Z") ? lastStartedAt : lastStartedAt.trim() + "Z").getTime();
      const elapsed = Number.isNaN(lastMs) ? cooldownMs : Date.now() - lastMs;
      if (elapsed >= 0 && elapsed < cooldownMs) {
        const retryAfter = Math.ceil((cooldownMs - elapsed) / 1e3);
        return c.json(
          { ok: false, reason: "rate_limited", retry_after_seconds: retryAfter },
          429
        );
      }
    }
  }
  log2.info("api", "Public manual run triggered (savings)");
  const result = await triggerDailyRun(c.env, { source: "manual", force: true });
  return c.json({ ok: true, result });
});
savingsPublicRoutes.get("/filters", async (c) => {
  const filters = await getSavingsFilters(c.env.DB);
  return c.json({ ok: true, filters });
});
savingsPublicRoutes.get("/rates", async (c) => {
  const q = c.req.query();
  const dir = String(q.dir || "desc").toLowerCase();
  const includeManual = q.include_manual === "true" || q.include_manual === "1";
  const result = await querySavingsRatesPaginated(c.env.DB, {
    page: Number(q.page || 1),
    size: Number(q.size || 50),
    startDate: q.start_date,
    endDate: q.end_date,
    bank: q.bank,
    accountType: q.account_type,
    rateType: q.rate_type,
    depositTier: q.deposit_tier,
    sort: q.sort,
    dir: dir === "asc" || dir === "desc" ? dir : "desc",
    includeManual
  });
  return c.json(result);
});
savingsPublicRoutes.get("/latest", async (c) => {
  const q = c.req.query();
  const orderByRaw = String(q.order_by || q.orderBy || "default").toLowerCase();
  const orderBy = orderByRaw === "rate_asc" || orderByRaw === "rate_desc" ? orderByRaw : "default";
  const rows4 = await queryLatestSavingsRates(c.env.DB, {
    bank: q.bank,
    accountType: q.account_type,
    rateType: q.rate_type,
    depositTier: q.deposit_tier,
    limit: Number(q.limit || 200),
    orderBy
  });
  return c.json({ ok: true, count: rows4.length, rows: rows4 });
});
savingsPublicRoutes.get("/timeseries", async (c) => {
  const q = c.req.query();
  const productKey = q.product_key || q.productKey;
  if (!productKey) {
    return jsonError(c, 400, "INVALID_REQUEST", "product_key is required for timeseries queries.");
  }
  const rows4 = await querySavingsTimeseries(c.env.DB, {
    bank: q.bank,
    productKey,
    accountType: q.account_type,
    rateType: q.rate_type,
    startDate: q.start_date,
    endDate: q.end_date,
    limit: Number(q.limit || 1e3)
  });
  return c.json({ ok: true, count: rows4.length, rows: rows4 });
});
savingsPublicRoutes.get("/export", async (c) => {
  const q = c.req.query();
  const format = String(q.format || "json").toLowerCase();
  if (format !== "csv" && format !== "json") {
    return jsonError(c, 400, "INVALID_FORMAT", "format must be csv or json");
  }
  const dir = String(q.dir || "desc").toLowerCase();
  const includeManual = q.include_manual === "true" || q.include_manual === "1";
  const { data, total } = await querySavingsForExport(c.env.DB, {
    startDate: q.start_date,
    endDate: q.end_date,
    bank: q.bank,
    accountType: q.account_type,
    rateType: q.rate_type,
    depositTier: q.deposit_tier,
    sort: q.sort,
    dir: dir === "asc" || dir === "desc" ? dir : "desc",
    includeManual
  });
  if (format === "csv") {
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", 'attachment; filename="savings-export.csv"');
    return c.body(toCsv2(data));
  }
  c.header("Content-Type", "application/json; charset=utf-8");
  c.header("Content-Disposition", 'attachment; filename="savings-export.json"');
  return c.json({ data, total, last_page: 1 });
});
savingsPublicRoutes.get("/export.csv", async (c) => {
  const q = c.req.query();
  const dataset = String(q.dataset || "latest").toLowerCase();
  if (dataset === "timeseries") {
    const productKey = q.product_key || q.productKey;
    if (!productKey) {
      return jsonError(c, 400, "INVALID_REQUEST", "product_key is required for timeseries CSV export.");
    }
    const rows5 = await querySavingsTimeseries(c.env.DB, {
      bank: q.bank,
      productKey,
      accountType: q.account_type,
      rateType: q.rate_type,
      startDate: q.start_date,
      endDate: q.end_date,
      limit: Number(q.limit || 5e3)
    });
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", 'attachment; filename="savings-timeseries.csv"');
    return c.body(toCsv2(rows5));
  }
  const rows4 = await queryLatestSavingsRates(c.env.DB, {
    bank: q.bank,
    accountType: q.account_type,
    rateType: q.rate_type,
    depositTier: q.deposit_tier,
    limit: Number(q.limit || 1e3)
  });
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", 'attachment; filename="savings-latest.csv"');
  return c.body(toCsv2(rows4));
});
function csvEscape2(value) {
  if (value == null) return "";
  const raw2 = String(value);
  if (/[",\n\r]/.test(raw2)) return `"${raw2.replace(/"/g, '""')}"`;
  return raw2;
}
__name(csvEscape2, "csvEscape");
function toCsv2(rows4) {
  if (rows4.length === 0) return "";
  const headers = Object.keys(rows4[0]);
  const lines = [headers.join(",")];
  for (const row of rows4) {
    lines.push(headers.map((h) => csvEscape2(row[h])).join(","));
  }
  return lines.join("\n");
}
__name(toCsv2, "toCsv");

// src/db/td-queries.ts
var MIN_PUBLIC_RATE3 = 0;
var MAX_PUBLIC_RATE3 = 15;
var MIN_CONFIDENCE2 = 0.85;
function safeLimit3(limit, fallback, max = 500) {
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(limit)));
}
__name(safeLimit3, "safeLimit");
function rows3(result) {
  return result.results ?? [];
}
__name(rows3, "rows");
async function getTdFilters(db) {
  const [banks, termMonths, depositTiers, interestPayments] = await Promise.all([
    db.prepare("SELECT DISTINCT bank_name AS value FROM historical_term_deposit_rates ORDER BY bank_name ASC").all(),
    db.prepare("SELECT DISTINCT term_months AS value FROM historical_term_deposit_rates ORDER BY CAST(term_months AS INTEGER) ASC").all(),
    db.prepare("SELECT DISTINCT deposit_tier AS value FROM historical_term_deposit_rates ORDER BY deposit_tier ASC").all(),
    db.prepare("SELECT DISTINCT interest_payment AS value FROM historical_term_deposit_rates ORDER BY interest_payment ASC").all()
  ]);
  const fallback = /* @__PURE__ */ __name((vals, fb) => vals.length > 0 ? vals : fb, "fallback");
  return {
    banks: rows3(banks).map((x) => x.value),
    term_months: rows3(termMonths).map((x) => x.value),
    deposit_tiers: rows3(depositTiers).map((x) => x.value),
    interest_payments: fallback(rows3(interestPayments).map((x) => x.value), INTEREST_PAYMENTS)
  };
}
__name(getTdFilters, "getTdFilters");
var SORT_COLUMNS2 = {
  collection_date: "h.collection_date",
  bank_name: "h.bank_name",
  product_name: "h.product_name",
  term_months: "h.term_months",
  interest_rate: "h.interest_rate",
  deposit_tier: "h.deposit_tier",
  interest_payment: "h.interest_payment",
  parsed_at: "h.parsed_at",
  run_source: "h.run_source"
};
function buildWhere2(filters) {
  const where = [];
  const binds = [];
  where.push("h.interest_rate BETWEEN ? AND ?");
  binds.push(MIN_PUBLIC_RATE3, MAX_PUBLIC_RATE3);
  where.push("h.confidence_score >= ?");
  binds.push(MIN_CONFIDENCE2);
  if (!filters.includeManual) where.push("(h.run_source IS NULL OR h.run_source != 'manual')");
  if (filters.bank) {
    where.push("h.bank_name = ?");
    binds.push(filters.bank);
  }
  if (filters.termMonths) {
    where.push("CAST(h.term_months AS TEXT) = ?");
    binds.push(filters.termMonths);
  }
  if (filters.depositTier) {
    where.push("h.deposit_tier = ?");
    binds.push(filters.depositTier);
  }
  if (filters.interestPayment) {
    where.push("h.interest_payment = ?");
    binds.push(filters.interestPayment);
  }
  if (filters.startDate) {
    where.push("h.collection_date >= ?");
    binds.push(filters.startDate);
  }
  if (filters.endDate) {
    where.push("h.collection_date <= ?");
    binds.push(filters.endDate);
  }
  return { clause: where.length ? `WHERE ${where.join(" AND ")}` : "", binds };
}
__name(buildWhere2, "buildWhere");
async function queryTdRatesPaginated(db, filters) {
  const { clause: whereClause, binds } = buildWhere2(filters);
  const sortCol = SORT_COLUMNS2[filters.sort ?? ""] ?? "h.collection_date";
  const sortDir = filters.dir === "desc" ? "DESC" : "ASC";
  const orderClause = `ORDER BY ${sortCol} ${sortDir}, h.bank_name ASC, h.product_name ASC`;
  const page = Math.max(1, Math.floor(Number(filters.page) || 1));
  const size = Math.min(500, Math.max(1, Math.floor(Number(filters.size) || 50)));
  const offset = (page - 1) * size;
  const countSql = `SELECT COUNT(*) AS total FROM historical_term_deposit_rates h ${whereClause}`;
  const dataSql = `
    SELECT
      h.bank_name, h.collection_date, h.product_id, h.product_name,
      h.term_months, h.interest_rate, h.deposit_tier,
      h.min_deposit, h.max_deposit, h.interest_payment,
      h.source_url, h.data_quality_flag, h.confidence_score,
      h.parsed_at, h.run_id, h.run_source,
      h.bank_name || '|' || h.product_id || '|' || h.term_months || '|' || h.deposit_tier AS product_key
    FROM historical_term_deposit_rates h
    ${whereClause} ${orderClause}
    LIMIT ? OFFSET ?
  `;
  const [countResult, dataResult] = await Promise.all([
    db.prepare(countSql).bind(...binds).first(),
    db.prepare(dataSql).bind(...binds, size, offset).all()
  ]);
  const total = Number(countResult?.total ?? 0);
  return { last_page: Math.max(1, Math.ceil(total / size)), total, data: rows3(dataResult) };
}
__name(queryTdRatesPaginated, "queryTdRatesPaginated");
async function queryLatestTdRates(db, filters) {
  const where = [];
  const binds = [];
  where.push("v.interest_rate BETWEEN ? AND ?");
  binds.push(MIN_PUBLIC_RATE3, MAX_PUBLIC_RATE3);
  where.push("v.confidence_score >= ?");
  binds.push(MIN_CONFIDENCE2);
  if (filters.bank) {
    where.push("v.bank_name = ?");
    binds.push(filters.bank);
  }
  if (filters.termMonths) {
    where.push("CAST(v.term_months AS TEXT) = ?");
    binds.push(filters.termMonths);
  }
  if (filters.depositTier) {
    where.push("v.deposit_tier = ?");
    binds.push(filters.depositTier);
  }
  if (filters.interestPayment) {
    where.push("v.interest_payment = ?");
    binds.push(filters.interestPayment);
  }
  const orderMap = {
    default: "v.collection_date DESC, v.bank_name ASC, v.product_name ASC",
    rate_asc: "v.interest_rate ASC, v.bank_name ASC",
    rate_desc: "v.interest_rate DESC, v.bank_name ASC"
  };
  const limit = safeLimit3(filters.limit, 200, 1e3);
  binds.push(limit);
  const sql = `
    SELECT v.*, v.product_key
    FROM vw_latest_td_rates v
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY ${orderMap[filters.orderBy ?? "default"] ?? orderMap.default}
    LIMIT ?
  `;
  const result = await db.prepare(sql).bind(...binds).all();
  return rows3(result);
}
__name(queryLatestTdRates, "queryLatestTdRates");
async function queryTdTimeseries(db, input) {
  const where = [];
  const binds = [];
  where.push("t.interest_rate BETWEEN ? AND ?");
  binds.push(MIN_PUBLIC_RATE3, MAX_PUBLIC_RATE3);
  where.push("t.confidence_score >= ?");
  binds.push(MIN_CONFIDENCE2);
  if (input.bank) {
    where.push("t.bank_name = ?");
    binds.push(input.bank);
  }
  if (input.productKey) {
    where.push("t.product_key = ?");
    binds.push(input.productKey);
  }
  if (input.termMonths) {
    where.push("CAST(t.term_months AS TEXT) = ?");
    binds.push(input.termMonths);
  }
  if (input.startDate) {
    where.push("t.collection_date >= ?");
    binds.push(input.startDate);
  }
  if (input.endDate) {
    where.push("t.collection_date <= ?");
    binds.push(input.endDate);
  }
  const limit = safeLimit3(input.limit, 500, 5e3);
  binds.push(limit);
  const sql = `
    SELECT t.*
    FROM vw_td_timeseries t
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY t.collection_date ASC
    LIMIT ?
  `;
  const result = await db.prepare(sql).bind(...binds).all();
  return rows3(result);
}
__name(queryTdTimeseries, "queryTdTimeseries");
async function queryTdForExport(db, filters, maxRows = 1e4) {
  const { clause: whereClause, binds } = buildWhere2(filters);
  const sortCol = SORT_COLUMNS2[filters.sort ?? ""] ?? "h.collection_date";
  const sortDir = filters.dir === "desc" ? "DESC" : "ASC";
  const limit = Math.min(maxRows, Math.max(1, Math.floor(Number(maxRows))));
  const countSql = `SELECT COUNT(*) AS total FROM historical_term_deposit_rates h ${whereClause}`;
  const dataSql = `
    SELECT
      h.bank_name, h.collection_date, h.product_id, h.product_name,
      h.term_months, h.interest_rate, h.deposit_tier,
      h.min_deposit, h.max_deposit, h.interest_payment,
      h.source_url, h.data_quality_flag, h.confidence_score,
      h.parsed_at, h.run_id, h.run_source,
      h.bank_name || '|' || h.product_id || '|' || h.term_months || '|' || h.deposit_tier AS product_key
    FROM historical_term_deposit_rates h
    ${whereClause}
    ORDER BY ${sortCol} ${sortDir}, h.bank_name ASC, h.product_name ASC
    LIMIT ?
  `;
  const [countResult, dataResult] = await Promise.all([
    db.prepare(countSql).bind(...binds).first(),
    db.prepare(dataSql).bind(...binds, limit).all()
  ]);
  return { data: rows3(dataResult), total: Number(countResult?.total ?? 0) };
}
__name(queryTdForExport, "queryTdForExport");

// src/routes/td-public.ts
var tdPublicRoutes = new Hono2();
tdPublicRoutes.use("*", async (c, next) => {
  withPublicCache(c, DEFAULT_PUBLIC_CACHE_SECONDS);
  await next();
});
tdPublicRoutes.get("/health", (c) => {
  withPublicCache(c, 30);
  return c.json({ ok: true, service: "australianrates-term-deposits" });
});
tdPublicRoutes.post("/trigger-run", async (c) => {
  const DEFAULT_COOLDOWN_SECONDS = 0;
  const cooldownSeconds = parseIntegerEnv(c.env.MANUAL_RUN_COOLDOWN_SECONDS, DEFAULT_COOLDOWN_SECONDS);
  const cooldownMs = cooldownSeconds * 1e3;
  if (cooldownMs > 0) {
    const lastStartedAt = await getLastManualRunStartedAt(c.env.DB);
    if (lastStartedAt) {
      const lastMs = new Date(lastStartedAt.endsWith("Z") ? lastStartedAt : lastStartedAt.trim() + "Z").getTime();
      const elapsed = Number.isNaN(lastMs) ? cooldownMs : Date.now() - lastMs;
      if (elapsed >= 0 && elapsed < cooldownMs) {
        const retryAfter = Math.ceil((cooldownMs - elapsed) / 1e3);
        return c.json(
          { ok: false, reason: "rate_limited", retry_after_seconds: retryAfter },
          429
        );
      }
    }
  }
  log2.info("api", "Public manual run triggered (term-deposits)");
  const result = await triggerDailyRun(c.env, { source: "manual", force: true });
  return c.json({ ok: true, result });
});
tdPublicRoutes.get("/filters", async (c) => {
  const filters = await getTdFilters(c.env.DB);
  return c.json({ ok: true, filters });
});
tdPublicRoutes.get("/rates", async (c) => {
  const q = c.req.query();
  const dir = String(q.dir || "desc").toLowerCase();
  const includeManual = q.include_manual === "true" || q.include_manual === "1";
  const result = await queryTdRatesPaginated(c.env.DB, {
    page: Number(q.page || 1),
    size: Number(q.size || 50),
    startDate: q.start_date,
    endDate: q.end_date,
    bank: q.bank,
    termMonths: q.term_months,
    depositTier: q.deposit_tier,
    interestPayment: q.interest_payment,
    sort: q.sort,
    dir: dir === "asc" || dir === "desc" ? dir : "desc",
    includeManual
  });
  return c.json(result);
});
tdPublicRoutes.get("/latest", async (c) => {
  const q = c.req.query();
  const orderByRaw = String(q.order_by || q.orderBy || "default").toLowerCase();
  const orderBy = orderByRaw === "rate_asc" || orderByRaw === "rate_desc" ? orderByRaw : "default";
  const rows4 = await queryLatestTdRates(c.env.DB, {
    bank: q.bank,
    termMonths: q.term_months,
    depositTier: q.deposit_tier,
    interestPayment: q.interest_payment,
    limit: Number(q.limit || 200),
    orderBy
  });
  return c.json({ ok: true, count: rows4.length, rows: rows4 });
});
tdPublicRoutes.get("/timeseries", async (c) => {
  const q = c.req.query();
  const productKey = q.product_key || q.productKey;
  if (!productKey) {
    return jsonError(c, 400, "INVALID_REQUEST", "product_key is required for timeseries queries.");
  }
  const rows4 = await queryTdTimeseries(c.env.DB, {
    bank: q.bank,
    productKey,
    termMonths: q.term_months,
    startDate: q.start_date,
    endDate: q.end_date,
    limit: Number(q.limit || 1e3)
  });
  return c.json({ ok: true, count: rows4.length, rows: rows4 });
});
tdPublicRoutes.get("/export", async (c) => {
  const q = c.req.query();
  const format = String(q.format || "json").toLowerCase();
  if (format !== "csv" && format !== "json") {
    return jsonError(c, 400, "INVALID_FORMAT", "format must be csv or json");
  }
  const dir = String(q.dir || "desc").toLowerCase();
  const includeManual = q.include_manual === "true" || q.include_manual === "1";
  const { data, total } = await queryTdForExport(c.env.DB, {
    startDate: q.start_date,
    endDate: q.end_date,
    bank: q.bank,
    termMonths: q.term_months,
    depositTier: q.deposit_tier,
    interestPayment: q.interest_payment,
    sort: q.sort,
    dir: dir === "asc" || dir === "desc" ? dir : "desc",
    includeManual
  });
  if (format === "csv") {
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", 'attachment; filename="td-export.csv"');
    return c.body(toCsv3(data));
  }
  c.header("Content-Type", "application/json; charset=utf-8");
  c.header("Content-Disposition", 'attachment; filename="td-export.json"');
  return c.json({ data, total, last_page: 1 });
});
tdPublicRoutes.get("/export.csv", async (c) => {
  const q = c.req.query();
  const dataset = String(q.dataset || "latest").toLowerCase();
  if (dataset === "timeseries") {
    const productKey = q.product_key || q.productKey;
    if (!productKey) {
      return jsonError(c, 400, "INVALID_REQUEST", "product_key is required for timeseries CSV export.");
    }
    const rows5 = await queryTdTimeseries(c.env.DB, {
      bank: q.bank,
      productKey,
      termMonths: q.term_months,
      startDate: q.start_date,
      endDate: q.end_date,
      limit: Number(q.limit || 5e3)
    });
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", 'attachment; filename="td-timeseries.csv"');
    return c.body(toCsv3(rows5));
  }
  const rows4 = await queryLatestTdRates(c.env.DB, {
    bank: q.bank,
    termMonths: q.term_months,
    depositTier: q.deposit_tier,
    interestPayment: q.interest_payment,
    limit: Number(q.limit || 1e3)
  });
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", 'attachment; filename="td-latest.csv"');
  return c.body(toCsv3(rows4));
});
function csvEscape3(value) {
  if (value == null) return "";
  const raw2 = String(value);
  if (/[",\n\r]/.test(raw2)) return `"${raw2.replace(/"/g, '""')}"`;
  return raw2;
}
__name(csvEscape3, "csvEscape");
function toCsv3(rows4) {
  if (rows4.length === 0) return "";
  const headers = Object.keys(rows4[0]);
  const lines = [headers.join(",")];
  for (const row of rows4) {
    lines.push(headers.map((h) => csvEscape3(row[h])).join(","));
  }
  return lines.join("\n");
}
__name(toCsv3, "toCsv");

// src/index.ts
var app = new Hono2();
app.use("*", async (c, next) => {
  initLogger(c.env.DB);
  await flushBufferedLogs();
  await next();
  await flushBufferedLogs();
});
app.use("*", logger());
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdn.jsdelivr.net", "https://cdn.plot.ly"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.github.com"]
    }
  })
);
app.use(
  "*",
  cors({
    origin: /* @__PURE__ */ __name((origin) => {
      if (!origin) return "*";
      if (origin.endsWith(".australianrates.com") || origin === "https://australianrates.com") return origin;
      if (origin.includes("localhost") || origin.includes("127.0.0.1")) return origin;
      return "https://www.australianrates.com";
    }, "origin"),
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Cf-Access-Jwt-Assertion"]
  })
);
app.route(API_BASE_PATH, publicRoutes);
app.route(`${API_BASE_PATH}/admin`, adminRoutes);
app.route(SAVINGS_API_BASE_PATH, savingsPublicRoutes);
app.route(TD_API_BASE_PATH, tdPublicRoutes);
app.notFound((c) => c.json({ ok: false, error: { code: "NOT_FOUND", message: "Route not found." } }, 404));
app.onError((error, c) => {
  log2.error("api", `Unhandled error: ${error?.message || String(error)}`, {
    context: error?.stack
  });
  return c.json({ ok: false, error: { code: "INTERNAL_ERROR", message: "Internal server error." } }, 500);
});
var worker = {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
  async scheduled(event, env) {
    initLogger(env.DB);
    log2.info("scheduler", `Cron triggered at ${new Date(event.scheduledTime).toISOString()}`);
    const result = await handleScheduledDaily(event, env);
    log2.info("scheduler", `Scheduled run completed`, { context: JSON.stringify(result) });
    await flushBufferedLogs();
  },
  async queue(batch, env) {
    initLogger(env.DB);
    await consumeIngestQueue(batch, env);
    await flushBufferedLogs();
  }
};
var index_default = worker;
export {
  RunLockDO,
  index_default as default
};
//# sourceMappingURL=index.js.map

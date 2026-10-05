// Re-exports the React UMD global as an ES module, so the component's untouched
// `import React, { useState, ... } from "react"` resolves without a bundler.
// index.html maps the "react" specifier here via an import map, and loads the
// UMD build in a classic <script> before any module runs.
const React = globalThis.React;
if (!React) {
  throw new Error('react-shim.js: the React UMD build must load before this module.');
}

export default React;

export const {
  Children, Component, Fragment, Profiler, PureComponent, StrictMode, Suspense,
  cloneElement, createContext, createElement, createRef, forwardRef,
  isValidElement, lazy, memo, startTransition, useCallback, useContext,
  useDebugValue, useDeferredValue, useEffect, useId, useImperativeHandle,
  useInsertionEffect, useLayoutEffect, useMemo, useReducer, useRef, useState,
  useSyncExternalStore, useTransition, version
} = React;

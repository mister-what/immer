"use strict"
// @ts-check

import {
    is,
    isProxyable,
    isProxy,
    freeze,
    PROXY_STATE,
    finalize,
    shallowCopy,
    verifyReturnValue,
    each
} from "./common"

let proxies = null

const objectTraps = {
    get,
    has(target, prop) {
        return prop in source(target)
    },
    ownKeys(target) {
        return Reflect.ownKeys(source(target))
    },
    set,
    deleteProperty,
    getOwnPropertyDescriptor,
    defineProperty,
    setPrototypeOf() {
        throw new Error("Don't even try this...")
    }
}

function ProxyForKeyStore() {
    const proxyMap = new Map()
    this.getOriginal = key => {
        if (proxyMap.has(key)) {
            return proxyMap.get(key)
        }
        return key
    }
    this.addKeyProxy = (originalKey, proxyKey) =>
        proxyMap.set(proxyKey, originalKey)
}

const proxyForKeyStore = new ProxyForKeyStore()

const mapMethods = {
    has: state => value => {
        if (state.modified) {
            return state.copy.has(value)
        } else {
            return state.base.has(value)
        }
    },
    get: state => key => {
        key = proxyForKeyStore.getOriginal(key)
        if (state.modified) {
            let value = state.copy.get(key)
            if (value === state.base.get(key) && isProxyable(value)) {
                value = createProxy(state, value)
                state.copy.set(key, value)
            }
            return value
        } else {
            if (state.mapProxies.has(key)) {
                return state.mapProxies.get(key).value
            }
            let value = state.base.get(key)
            if (!isProxy(value) && isProxyable(value)) {
                value = createProxy(state, value)
                state.mapProxies.set(key, {
                    value,
                    key:
                        !isProxy(key) && isProxyable(key)
                            ? createProxy(state, key)
                            : key
                })
            }
            return value
        }
    },
    delete: state => key => {
        if (!state.modified && state.base.has(key)) {
            markChanged(state)
            return state.copy.delete(key)
        } else if (state.modified && state.copy.has(key)) {
            return state.copy.delete(key)
        }
        return false
    },
    clear: state => () => {
        if (state.modified) {
            state.copy.clear()
        } else {
            if (state.base.size === 0) {
                return
            }
            markChanged(state)
            state.copy.clear()
        }
    },
    values: state => () => {},
    entries: state => () => {
        function* entriesGenerator(mapObj) {
            const getter = mapMethods.get(state)
            const iterator = mapObj.entries()
            for (let entry of iterator) {
                let [key] = entry
                let proxyKey = key
                if (!isProxy(key) && isProxyable(key)) {
                    proxyKey = createProxy(state, key)
                    proxyForKeyStore.addKeyProxy(key, proxyKey)
                }
                yield [proxyKey, getter(proxyKey)]
            }
        }

        if (state.modified) {
            return entriesGenerator(state.copy)
        } else {
            return entriesGenerator(state.base)
        }
    },
    forEach: state => (callback, thisArg) => {
        if (thisArg) {
            callback.bind(thisArg)
        }
        const entriesForState = mapMethods.entries(state)
        for (let entry of entriesForState) {
            const [key, value] = entry
            const mapObj = state.modified ? state.copy : state.base
            callback(value, key, mapObj)
        }
    },
    set: state => (key, value) => {
        let returnValue

        if (!state.modified) {
            if (!state.base.has(proxyForKeyStore.getOriginal(key))) {
                markChanged(state)
                state.copy.set(key, value)
                returnValue = state.copy
            } else {
                returnValue = state.base
            }
        } else {
            state.copy.set(key, value)
            returnValue = state.copy
        }
        return returnValue
    }
}
const arrayTraps = {}
each(objectTraps, (key, fn) => {
    arrayTraps[key] = function() {
        arguments[0] = arguments[0][0]
        return fn.apply(this, arguments)
    }
})

function createState(parent, base) {
    return {
        modified: false,
        finalized: false,
        parent,
        base,
        copy: undefined,
        proxies: {},
        mapProxies: new Map()
    }
}

function source(state) {
    return state.modified === true ? state.copy : state.base
}

function get(state, prop) {
    if (prop === PROXY_STATE) {
        return state
    }
    if (state.base instanceof Map && prop in mapMethods) {
        return mapMethods[prop](state)
    }
    if (state.modified) {
        const value = state.copy[prop]
        if (value === state.base[prop] && isProxyable(value)) {
            // only create proxy if it is not yet a proxy, and not a new object
            // (new objects don't need proxying, they will be processed in finalize anyway)
            return (state.copy[prop] = createProxy(state, value))
        }
        return value
    } else {
        if (prop !== "constructor" && prop in state.proxies) {
            return state.proxies[prop]
        }
        const value = state.base[prop]
        if (!isProxy(value) && isProxyable(value)) {
            return (state.proxies[prop] = createProxy(state, value))
        }
        return value
    }
}

function set(state, prop, value) {
    if (!state.modified) {
        if (
            (prop in state.base && is(state.base[prop], value)) ||
            (prop in state.proxies && state.proxies[prop] === value)
        ) {
            return true
        }
        markChanged(state)
    }
    state.copy[prop] = value
    return true
}

function deleteProperty(state, prop) {
    if (!state.modified && prop in state.base) {
        markChanged(state)
        delete state.copy[prop]
    } else if (state.modified && prop in state.copy) {
        delete state.copy[prop]
    }
    return true
}

function getOwnPropertyDescriptor(state, prop) {
    const owner = state.modified
        ? state.copy
        : prop in state.proxies ? state.proxies : state.base
    const descriptor = Reflect.getOwnPropertyDescriptor(owner, prop)
    if (
        descriptor &&
        !(Array.isArray(owner) && prop === "length") &&
        !(owner instanceof Set)
    ) {
        descriptor.configurable = true
    }
    return descriptor
}

function defineProperty() {
    throw new Error(
        "Immer does currently not support defining properties on draft objects"
    )
}
function markChanged(state) {
    if (!state.modified) {
        state.copy = shallowCopy(state.base)
        // copy the proxies over the base-copy
        Object.assign(state.copy, state.proxies) // yup that works for arrays as well
        state.modified = true
        if (state.base instanceof Map) {
            state.copy = Object.assign(new Map(state.base), state.copy)
            state.mapProxies.forEach((mapProxy, key) => {
                state.copy.set(key, mapProxy)
            })
        }
        if (state.parent) {
            markChanged(state.parent)
        }
    }
}

// creates a proxy for plain objects / arrays
function createProxy(parentState, base) {
    const state = createState(parentState, base)
    const proxy = Array.isArray(base)
        ? Proxy.revocable([state], arrayTraps)
        : Proxy.revocable(state, objectTraps)
    proxies.push(proxy)
    return proxy.proxy
}

export function produceProxy(baseState, producer) {
    const previousProxies = proxies
    proxies = []
    try {
        // create proxy for root
        const rootClone = createProxy(undefined, baseState)
        // execute the thunk
        verifyReturnValue(producer(rootClone))
        // and finalize the modified proxy
        const res = finalize(rootClone)
        // revoke all proxies
        each(proxies, (_, p) => p.revoke())
        return res
    } finally {
        proxies = previousProxies
    }
}

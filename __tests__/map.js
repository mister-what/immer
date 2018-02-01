import produce, {setAutoFreeze, setUseProxies} from "../src"

describe("Native Map tests", function() {
    beforeAll(() => {
        setUseProxies(true)
        setAutoFreeze(false)
    })
    it("should add entries", () => {
        const state = {
            someMap: new Map()
        }
        const newState = produce(state, draft => {
            draft.someMap.set("key", "value")
        })
        expect(newState.someMap.has("key")).toBeTruthy()
        expect(state.someMap.has("key")).toBeFalsy()
        expect(newState).not.toEqual(state)
        expect(newState.someMap).not.toEqual(state.someMap)
    })

    it("should add entries with objects as keys", () => {
        const keys = [{}, {}]
        const state = {
            someMap: new Map([[keys[0], "foo"]])
        }
        const newState = produce(state, draft => {
            draft.someMap.set(keys[1], "bar")
            draft.someMap.set(keys[0], "baz")
        })
        expect(newState.someMap.has(keys[1])).toBeTruthy()
        expect(state.someMap.has(keys[1])).toBeFalsy()
        expect(newState.someMap.get(keys[1])).toBe("bar")
        expect(newState.someMap.get(keys[0])).toBe("baz")
        expect(newState.someMap.get(keys[0])).not.toBe(
            state.someMap.get(keys[0])
        )
        expect(state.someMap.has(keys[1])).toBeFalsy()
        expect(newState).not.toEqual(state)
        expect(newState.someMap).not.toEqual(state.someMap)
    })
})

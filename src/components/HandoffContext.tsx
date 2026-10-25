import { createContext, useContext } from 'react'
import { disabledHandoff } from '../shared/handoff'

export const HandoffContext = createContext(disabledHandoff)
export const useHandoff = () => useContext(HandoffContext)

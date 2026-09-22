'use client'

import { createContext, useContext, useState } from 'react'

const FeedbackContext = createContext({
  isOpen: false,
  openFeedback: () => {},
  closeFeedback: () => {},
})

export function FeedbackProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false)

  const value = {
    isOpen,
    openFeedback: () => setIsOpen(true),
    closeFeedback: () => setIsOpen(false),
  }

  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>
}

export function useFeedback() {
  return useContext(FeedbackContext)
}

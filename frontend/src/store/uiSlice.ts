import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

type UiState = {
  commentOpen: boolean
}

const initialState: UiState = {
  commentOpen: false,
}

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setCommentOpen(state, action: PayloadAction<boolean>) {
      state.commentOpen = action.payload
    },
  },
})

export const { setCommentOpen } = uiSlice.actions
export const uiReducer = uiSlice.reducer

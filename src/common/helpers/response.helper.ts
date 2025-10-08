// src/common/helpers/response.helper.ts

export interface ApiResponse<T> {
  status: 'success' | 'error';
  message: string;
  data?: T;
}

export function successResponse<T>(
  message: string,
  data?: T
): ApiResponse<T> {
  return {
    status: 'success',
    message,
    data,
  };
}

export function errorResponse(
  message: string
): ApiResponse<null> {
  return {
    status: 'error',
    message,
    data: null,
  };
}



export const errorHandler = (statusCode: number, message: string): Error => {

  const error = new Error(message);

  (error as any).statusCode = statusCode;

  return error;
  
};

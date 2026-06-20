import { ArgumentsHost, HttpStatus, Logger } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  it('does not expose unhandled exception messages to clients', () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status, json }),
        getRequest: () => ({ url: '/api/v1/events' }),
      }),
    } as unknown as ArgumentsHost;

    new AllExceptionsFilter().catch(
      new Error('database password leaked in driver error'),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
        path: '/api/v1/events',
      }),
    );
  });
});

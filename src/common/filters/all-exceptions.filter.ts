import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorResponse {
  statusCode: number;
  timestamp: string;
  path: string;
  message: string;
  details?: unknown;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: unknown;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'object') {
        const typedResponse = exceptionResponse as {
          message?: string | string[];
        };
        message = Array.isArray(typedResponse.message)
          ? typedResponse.message.join(', ')
          : typedResponse.message || exception.message;
        details = exceptionResponse;
      } else {
        message = exceptionResponse as string;
      }
    } else if (exception instanceof Error) {
      this.logger.error(
        `Unhandled error: ${exception.message}`,
        exception.stack,
      );
    } else {
      this.logger.error(`Unknown error: ${JSON.stringify(exception)}`);
    }

    const errorResponse: ErrorResponse = {
      statusCode,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
      details: process.env.NODE_ENV === 'development' ? details : undefined,
    };

    response.status(statusCode).json(errorResponse);
  }
}

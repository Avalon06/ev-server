import ChargingStation, { Connector, RemoteAuthorization } from '../../../../types/ChargingStation';
import { NextFunction, Request, Response } from 'express';
import { OCPICommandResponse, OCPICommandResponseType } from '../../../../types/ocpi/OCPICommandResponse';

import AbstractEndpoint from '../AbstractEndpoint';
import AbstractOCPIService from '../../AbstractOCPIService';
import AppError from '../../../../exception/AppError';
import BackendError from '../../../../exception/BackendError';
import { ChargePointStatus } from '../../../../types/ocpp/OCPPServer';
import ChargingStationClientFactory from '../../../../client/ocpp/ChargingStationClientFactory';
import ChargingStationStorage from '../../../../storage/mongodb/ChargingStationStorage';
import Constants from '../../../../utils/Constants';
import HttpStatusCodes from 'http-status-codes';
import Logging from '../../../../utils/Logging';
import { OCPICommandType } from '../../../../types/ocpi/OCPICommandType';
import OCPIEndpoint from '../../../../types/ocpi/OCPIEndpoint';
import { OCPIResponse } from '../../../../types/ocpi/OCPIResponse';
import { OCPIStartSession } from '../../../../types/ocpi/OCPIStartSession';
import { OCPIStatusCode } from '../../../../types/ocpi/OCPIStatusCode';
import { OCPIStopSession } from '../../../../types/ocpi/OCPIStopSession';
import OCPITokensService from './OCPITokensService';
import OCPIUtils from '../../OCPIUtils';
import { OCPPRemoteStartStopStatus } from '../../../../types/ocpp/OCPPClient';
import { ServerAction } from '../../../../types/Server';
import Tenant from '../../../../types/Tenant';
import TransactionStorage from '../../../../storage/mongodb/TransactionStorage';
import UserStorage from '../../../../storage/mongodb/UserStorage';
import axios from 'axios';
import moment from 'moment';

const EP_IDENTIFIER = 'commands';
const MODULE_NAME = 'CPOCommandsEndpoint';

/**
 * EMSP Tokens Endpoint
 */
export default class CPOCommandsEndpoint extends AbstractEndpoint {
  // Create OCPI Service
  constructor(ocpiService: AbstractOCPIService) {
    super(ocpiService, EP_IDENTIFIER);
  }

  /**
   * Main Process Method for the endpoint
   */
  async process(req: Request, res: Response, next: NextFunction, tenant: Tenant, ocpiEndpoint: OCPIEndpoint): Promise<OCPIResponse> {
    switch (req.method) {
      case 'POST':
        // Split URL Segments
        //    /ocpi/cpo/2.0/commands/{command}
        // eslint-disable-next-line no-case-declarations
        const urlSegment = req.path.substring(1).split('/');
        // Remove action
        urlSegment.shift();
        // Get filters
        // eslint-disable-next-line no-case-declarations
        const command = urlSegment.shift();
        switch (command) {
          case OCPICommandType.START_SESSION:
            return this.remoteStartSession(req, res, next, tenant, ocpiEndpoint);
          case OCPICommandType.STOP_SESSION:
            return this.remoteStopSession(req, res, next, tenant, ocpiEndpoint);
          case OCPICommandType.RESERVE_NOW:
          case OCPICommandType.UNLOCK_CONNECTOR:
            return this.getOCPIResponse(OCPICommandResponseType.NOT_SUPPORTED);
        }
    }
  }

  /**
   * Remote start session requested by IOP
   */
  async remoteStartSession(req: Request, res: Response, next: NextFunction, tenant: Tenant, ocpiEndpoint: OCPIEndpoint): Promise<OCPIResponse> {
    const startSession = req.body as OCPIStartSession;
    if (!this.validateStartSession(startSession)) {
      throw new AppError({
        source: Constants.OCPI_SERVER,
        module: MODULE_NAME, method: 'remoteStartSession',
        action: ServerAction.OCPI_START_SESSION,
        errorCode: HttpStatusCodes.BAD_REQUEST,
        message: 'StartSession command body is invalid',
        detailedMessages: { payload: req.body },
        ocpiError: OCPIStatusCode.CODE_2001_INVALID_PARAMETER_ERROR
      });
    }
    const user = await UserStorage.getUserByTagId(tenant.id, startSession.token.uid);
    if (!user || user.deleted || user.issuer) {
      return this.getOCPIResponse(OCPICommandResponseType.REJECTED);
    }
    const localToken = user.tags.find((tag) => tag.id === startSession.token.uid);
    if (!localToken || !localToken.active || !localToken.ocpiToken || !localToken.ocpiToken.valid) {
      Logging.logDebug({
        tenantID: tenant.id,
        action: ServerAction.OCPI_START_SESSION,
        message: `Stat session token '${startSession.token.uid}' is invalid`,
        module: MODULE_NAME, method: 'remoteStartSession'
      });
      return this.getOCPIResponse(OCPICommandResponseType.REJECTED);
    }

    let chargingStation: ChargingStation;
    let connector: Connector;
    const chargingStations = await ChargingStationStorage.getChargingStations(tenant.id, {
      siteIDs: [startSession.location_id],
      issuer: true
    }, Constants.DB_PARAMS_MAX_LIMIT);
    if (chargingStations && chargingStations.result) {
      for (const cs of chargingStations.result) {
        cs.connectors.forEach((conn) => {
          if (startSession.evse_uid === OCPIUtils.buildEvseUID(cs, conn)) {
            chargingStation = cs;
            connector = conn;
          }
        });
      }
    }

    if (!chargingStation) {
      Logging.logDebug({
        tenantID: tenant.id,
        action: ServerAction.OCPI_START_SESSION,
        message: `Charging station with evse_uid '${startSession.evse_uid}' not found`,
        module: MODULE_NAME, method: 'remoteStartSession'
      });
      return this.getOCPIResponse(OCPICommandResponseType.REJECTED);
    }
    if (!connector) {
      Logging.logDebug({
        tenantID: tenant.id,
        action: ServerAction.OCPI_START_SESSION,
        message: `Connector for charging station with evse_uid '${startSession.evse_uid}' not found`,
        module: MODULE_NAME, method: 'remoteStartSession'
      });
      return this.getOCPIResponse(OCPICommandResponseType.REJECTED);
    }
    if (!chargingStation.issuer || chargingStation.private) {
      Logging.logDebug({
        tenantID: tenant.id,
        action: ServerAction.OCPI_START_SESSION,
        message: `Charging station with evse_uid '${startSession.evse_uid}' cannot be used in with OCPI`,
        module: MODULE_NAME, method: 'remoteStartSession'
      });
      return this.getOCPIResponse(OCPICommandResponseType.REJECTED);
    }
    if (connector.status !== ChargePointStatus.AVAILABLE) {
      Logging.logDebug({
        tenantID: tenant.id,
        action: ServerAction.OCPI_STOP_SESSION,
        message: `Charging station with evse_uid '${startSession.evse_uid}' is not available`,
        module: MODULE_NAME, method: 'remoteStartSession'
      });
      return this.getOCPIResponse(OCPICommandResponseType.REJECTED);
    }
    if (!chargingStation.remoteAuthorizations) {
      chargingStation.remoteAuthorizations = [];
    }
    const existingAuthorization: RemoteAuthorization = chargingStation.remoteAuthorizations.find((authorization) => authorization.connectorId === connector.connectorId);
    if (existingAuthorization) {
      if (OCPIUtils.isAuthorizationValid(existingAuthorization.timestamp)) {
        Logging.logDebug({
          tenantID: tenant.id,
          source: chargingStation.id,
          action: ServerAction.OCPI_START_SESSION,
          message: `An existing remote authorization exists for charging station '${chargingStation.id}' and connector ${connector.connectorId}`,
          module: MODULE_NAME, method: 'remoteStartSession'
        });
        return this.getOCPIResponse(OCPICommandResponseType.REJECTED);
      }
      existingAuthorization.timestamp = moment().toDate();
      existingAuthorization.id = startSession.authorization_id;
      existingAuthorization.tagId = startSession.token.uid;
    } else {
      chargingStation.remoteAuthorizations.push(
        {
          id: startSession.authorization_id,
          connectorId: connector.connectorId,
          timestamp: new Date(),
          tagId: startSession.token.uid
        }
      );
    }
    await ChargingStationStorage.saveChargingStation(tenant.id, chargingStation);
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.remoteStartTransaction(tenant, chargingStation, connector, startSession, ocpiEndpoint);
    return this.getOCPIResponse(OCPICommandResponseType.ACCEPTED);
  }

  /**
   * Remote stop session requested by IOP
   */
  async remoteStopSession(req: Request, res: Response, next: NextFunction, tenant: Tenant, ocpiEndpoint: OCPIEndpoint): Promise<OCPIResponse> {
    const stopSession = req.body as OCPIStopSession;
    if (!this.validateStopSession(stopSession)) {
      throw new AppError({
        source: Constants.OCPI_SERVER,
        module: MODULE_NAME, method: 'remoteStopSession',
        action: ServerAction.OCPI_START_SESSION,
        errorCode: HttpStatusCodes.BAD_REQUEST,
        message: 'StopSession command body is invalid',
        detailedMessages: { payload: req.body },
        ocpiError: OCPIStatusCode.CODE_2001_INVALID_PARAMETER_ERROR
      });
    }
    const transaction = await TransactionStorage.getOCPITransaction(tenant.id, stopSession.session_id);
    if (!transaction) {
      Logging.logDebug({
        tenantID: tenant.id,
        action: ServerAction.OCPI_STOP_SESSION,
        message: `Transaction with ocpi session id '${stopSession.session_id}' does not exists`,
        module: MODULE_NAME, method: 'remoteStopSession'
      });
      return this.getOCPIResponse(OCPICommandResponseType.REJECTED);
    }
    if (!transaction.issuer) {
      Logging.logDebug({
        tenantID: tenant.id,
        action: ServerAction.OCPI_STOP_SESSION,
        message: `Transaction with ocpi session id '${stopSession.session_id}' has been issued locally`,
        module: MODULE_NAME, method: 'remoteStopSession'
      });
      return this.getOCPIResponse(OCPICommandResponseType.REJECTED);
    }
    if (transaction.stop) {
      Logging.logDebug({
        tenantID: tenant.id,
        action: ServerAction.OCPI_STOP_SESSION,
        message: `Transaction with ocpi session id '${stopSession.session_id}' is already stopped`,
        module: MODULE_NAME, method: 'remoteStopSession'
      });
      return this.getOCPIResponse(OCPICommandResponseType.REJECTED);
    }

    const chargingStation = await ChargingStationStorage.getChargingStation(tenant.id, transaction.chargeBoxID);
    if (!chargingStation) {
      Logging.logDebug({
        tenantID: tenant.id,
        source: transaction.chargeBoxID,
        action: ServerAction.OCPI_STOP_SESSION,
        message: `Charging station '${transaction.chargeBoxID}' not found`,
        module: MODULE_NAME, method: 'remoteStopSession'
      });
      return this.getOCPIResponse(OCPICommandResponseType.REJECTED);
    }
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.remoteStopTransaction(tenant, chargingStation, transaction.id, stopSession, ocpiEndpoint);

    return this.getOCPIResponse(OCPICommandResponseType.ACCEPTED);
  }

  private getOCPIResponse(responseType: OCPICommandResponseType): OCPIResponse {
    return OCPIUtils.success({ result: responseType });
  }

  private validateStartSession(startSession: OCPIStartSession): boolean {
    if (!startSession
      || !startSession.response_url
      || !startSession.evse_uid
      || !startSession.location_id
      || !startSession.token
      || !startSession.authorization_id
    ) {
      return false;
    }
    return OCPITokensService.validateToken(startSession.token);
  }

  private validateStopSession(stopSession: OCPIStopSession): boolean {
    if (!stopSession
      || !stopSession.response_url
      || !stopSession.session_id
    ) {
      return false;
    }
    return true;
  }

  private async remoteStartTransaction(tenant: Tenant, chargingStation: ChargingStation, connector: Connector, startSession: OCPIStartSession, ocpiEndpoint: OCPIEndpoint): Promise<void> {
    const chargingStationClient = await ChargingStationClientFactory.getChargingStationClient(tenant.id, chargingStation);
    if (!chargingStationClient) {
      return;
    }

    const result = await chargingStationClient.remoteStartTransaction({
      connectorId: connector.connectorId,
      idTag: startSession.token.uid
    });

    if (result && result.status === OCPPRemoteStartStopStatus.ACCEPTED) {
      await this.sendCommandResponse(tenant, ServerAction.OCPI_START_SESSION, startSession.response_url, OCPICommandResponseType.ACCEPTED, ocpiEndpoint);
    } else {
      await this.sendCommandResponse(tenant, ServerAction.OCPI_START_SESSION, startSession.response_url, OCPICommandResponseType.ACCEPTED, ocpiEndpoint);
    }
  }

  private async remoteStopTransaction(tenant: Tenant, chargingStation: ChargingStation, transactionId: number, stopSession: OCPIStopSession, ocpiEndpoint: OCPIEndpoint): Promise<void> {
    const chargingStationClient = await ChargingStationClientFactory.getChargingStationClient(tenant.id, chargingStation);
    if (!chargingStationClient) {
      return;
    }

    const result = await chargingStationClient.remoteStopTransaction({
      transactionId: transactionId
    });

    if (result && result.status === OCPPRemoteStartStopStatus.ACCEPTED) {
      await this.sendCommandResponse(tenant, ServerAction.OCPI_STOP_SESSION, stopSession.response_url, OCPICommandResponseType.ACCEPTED, ocpiEndpoint);
    } else {
      await this.sendCommandResponse(tenant, ServerAction.OCPI_STOP_SESSION, stopSession.response_url, OCPICommandResponseType.ACCEPTED, ocpiEndpoint);
    }
  }

  private async sendCommandResponse(tenant: Tenant, action: ServerAction, responseUrl: string, responseType: OCPICommandResponseType, ocpiEndpoint: OCPIEndpoint) {
    // Build payload
    const payload: OCPICommandResponse =
      {
        result: responseType
      };
    // Log
    Logging.logDebug({
      tenantID: tenant.id,
      action: action,
      message: `Post command response at ${responseUrl}`,
      module: MODULE_NAME, method: 'sendCommandResponse',
      detailedMessages: { payload }
    });
    // Call IOP
    const response = await axios.post(responseUrl, payload,
      {
        headers: {
          Authorization: `Token ${ocpiEndpoint.token}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });
    // Check response
    if (response.status !== 200 || !response.data) {
      throw new BackendError({
        action: action,
        message: `Post send command response failed with status ${response.status}`,
        module: MODULE_NAME, method: 'sendCommandResponse',
        detailedMessages: { payload: response.data }
      });
    }
  }
}


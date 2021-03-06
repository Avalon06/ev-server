import { OCPPProtocol, OCPPVersion } from '../../../../types/ocpp/OCPPServer';

import Constants from '../../../../utils/Constants';
import Logging from '../../../../utils/Logging';
import { ServerAction } from '../../../../types/Server';
import Utils from '../../../../utils/Utils';
import global from '../../../../types/GlobalType';

const MODULE_NAME = 'SoapCentralSystemService16';

export default { /* Services */
  CentralSystemService: { /* Ports */
    CentralSystemServiceSoap12: { /* Methods */
      Authorize: function(args, callback, headers, req) {
        // Check SOAP params
        Utils.normalizeAndCheckSOAPParams(headers, req).then(async () => {
          // Log
          Logging.logReceivedAction(MODULE_NAME, headers.tenantID, headers.chargeBoxIdentity, ServerAction.AUTHORIZE, [ headers, args ]);
          // Handle
          const result = await global.centralSystemSoap.getChargingStationService(OCPPVersion.VERSION_16).handleAuthorize(headers, args);
          // Log
          Logging.logReturnedAction(MODULE_NAME, headers.tenantID, headers.chargeBoxIdentity, ServerAction.AUTHORIZE, {
            'result': result
          });
          // Answer
          callback({
            'authorizeResponse': {
              'idTagInfo': {
                'status': result.status
              }
            }
          });
        }).catch((error) => {
          // Log
          Logging.logException(error, ServerAction.AUTHORIZE, headers.chargeBoxIdentity,
            MODULE_NAME, 'Authorize', (headers.tenantID ? headers.tenantID : Constants.DEFAULT_TENANT));
          callback({
            'authorizeResponse': {
              'idTagInfo': {
                'status': 'Invalid'
              }
            }
          });
        });
      },

      BootNotification: function(args, callback, headers, req) {
        // Check SOAP params
        Utils.normalizeAndCheckSOAPParams(headers, req).then(async () => {
          // Add current IP to charging station properties
          headers.currentIPAddress = Utils.getRequestIP(req);
          // Add OCPP Version
          headers.ocppVersion = OCPPVersion.VERSION_16;
          headers.ocppProtocol = OCPPProtocol.SOAP;
          // Add current IP to charging station properties
          headers.currentIPAddress = Utils.getRequestIP(req);
          // Log
          Logging.logReceivedAction(MODULE_NAME, headers.tenantID, headers.chargeBoxIdentity, ServerAction.BOOT_NOTIFICATION, [ headers, args ]);
          // Handle
          const result = await global.centralSystemSoap.getChargingStationService(OCPPVersion.VERSION_16).handleBootNotification(headers, args);
          // Log
          Logging.logReturnedAction(MODULE_NAME, headers.tenantID, headers.chargeBoxIdentity, ServerAction.BOOT_NOTIFICATION, {
            'result': result
          });
          callback({
            'bootNotificationResponse': {
              'currentTime': result.currentTime,
              'status': result.status,
              'interval': result.heartbeatInterval
            }
          });
        }).catch((error) => {
          // Log
          Logging.logException(error, ServerAction.BOOT_NOTIFICATION, headers.chargeBoxIdentity,
            MODULE_NAME, 'BootNotification', (headers.tenantID ? headers.tenantID : Constants.DEFAULT_TENANT));
          callback({
            'bootNotificationResponse': {
              'status': 'Rejected',
              'currentTime': new Date().toISOString(),
              'interval': 60
            }
          });
        });
      },

      DataTransfer: function(args, callback, headers, req) {
        // Check SOAP params
        Utils.normalizeAndCheckSOAPParams(headers, req).then(async () => {
          // Log
          Logging.logReceivedAction(MODULE_NAME, headers.tenantID, headers.chargeBoxIdentity, ServerAction.CHARGING_STATION_DATA_TRANSFER, [ headers, args ]);
          // Handle
          const result = await global.centralSystemSoap.getChargingStationService(OCPPVersion.VERSION_16).handleDataTransfer(headers, args);
          // Log
          Logging.logReturnedAction(MODULE_NAME, headers.tenantID, headers.chargeBoxIdentity, ServerAction.CHARGING_STATION_DATA_TRANSFER, {
            'result': result
          });
          callback({
            'dataTransferResponse': {
              'status': result.status
            }
          });
        }).catch((error) => {
          // Log
          Logging.logException(error, ServerAction.CHARGING_STATION_DATA_TRANSFER, headers.chargeBoxIdentity,
            MODULE_NAME, 'DataTransfer', (headers.tenantID ? headers.tenantID : Constants.DEFAULT_TENANT));
          callback({
            'dataTransferResponse': {
              'status': 'Rejected'
            }
          });
        });
      },

      DiagnosticsStatusNotification: function(args, callback, headers, req) {
        // Check SOAP params
        Utils.normalizeAndCheckSOAPParams(headers, req).then(async () => {
          // Log
          Logging.logReceivedAction(MODULE_NAME, headers.tenantID, headers.chargeBoxIdentity, ServerAction.DIAGNOSTICS_STATUS_NOTIFICATION, [ headers, args ]);
          // Handle
          const result = await global.centralSystemSoap.getChargingStationService(OCPPVersion.VERSION_16).handleDiagnosticsStatusNotification(headers, args);
          // Log
          Logging.logReturnedAction(MODULE_NAME, headers.tenantID, headers.chargeBoxIdentity, ServerAction.DIAGNOSTICS_STATUS_NOTIFICATION, {
            'result': result
          });
          callback({
            'diagnosticsStatusNotificationResponse': {}
          });
        }).catch((error) => {
          // Log
          Logging.logException(error, ServerAction.DIAGNOSTICS_STATUS_NOTIFICATION, headers.chargeBoxIdentity,
            MODULE_NAME, 'DiagnosticsStatusNotification', (headers.tenantID ? headers.tenantID : Constants.DEFAULT_TENANT));
          callback({
            'diagnosticsStatusNotificationResponse': {}
          });
        });
      },

      FirmwareStatusNotification: function(args, callback, headers, req) {
        // Check SOAP params
        Utils.normalizeAndCheckSOAPParams(headers, req).then(async () => {
          // Log
          Logging.logReceivedAction(MODULE_NAME, headers.tenantID, headers.chargeBoxIdentity, ServerAction.FIRMWARE_STATUS_NOTIFICATION, [ headers, args ]);
          // Handle
          const result = await global.centralSystemSoap.getChargingStationService(OCPPVersion.VERSION_16).handleFirmwareStatusNotification(headers, args);
          // Log
          Logging.logReturnedAction(MODULE_NAME, headers.tenantID, headers.chargeBoxIdentity, ServerAction.FIRMWARE_STATUS_NOTIFICATION, {
            'result': result
          });
          callback({
            'firmwareStatusNotificationResponse': {}
          });
        }).catch((error) => {
          // Log
          Logging.logException(error, ServerAction.FIRMWARE_STATUS_NOTIFICATION, headers.chargeBoxIdentity,
            MODULE_NAME, 'FirmwareStatusNotification', (headers.tenantID ? headers.tenantID : Constants.DEFAULT_TENANT));
          callback({
            'firmwareStatusNotificationResponse': {}
          });
        });
      },

      Heartbeat: function(args, callback, headers, req) {
        // Check SOAP params
        Utils.normalizeAndCheckSOAPParams(headers, req).then(async () => {
          // Add current IP to charging station properties
          headers.currentIPAddress = Utils.getRequestIP(req);
          // Log
          Logging.logReceivedAction(MODULE_NAME, headers.tenantID, headers.chargeBoxIdentity, ServerAction.HEARTBEAT, [ headers, args ]);
          // Handle
          const result = await global.centralSystemSoap.getChargingStationService(OCPPVersion.VERSION_16).handleHeartbeat(headers, args);
          // Log
          Logging.logReturnedAction(MODULE_NAME, headers.tenantID, headers.chargeBoxIdentity, ServerAction.HEARTBEAT, {
            'result': result
          });
          callback({
            'heartbeatResponse': {
              'currentTime': result.currentTime
            }
          });
        }).catch((error) => {
          // Log
          Logging.logException(error, ServerAction.HEARTBEAT, headers.chargeBoxIdentity,
            MODULE_NAME, 'Heartbeat', (headers.tenantID ? headers.tenantID : Constants.DEFAULT_TENANT));
          callback({
            'heartbeatResponse': {
              'currentTime': new Date().toISOString()
            }
          });
        });
      },

      MeterValues: function(args, callback, headers, req) {
        // Check SOAP params
        Utils.normalizeAndCheckSOAPParams(headers, req).then(async () => {
          // Log
          Logging.logReceivedAction(MODULE_NAME, headers.tenantID, headers.chargeBoxIdentity, ServerAction.METER_VALUES, [ headers, args ]);
          // Handle
          const result = await global.centralSystemSoap.getChargingStationService(OCPPVersion.VERSION_16).handleMeterValues(headers, args);
          // Return the result async
          Logging.logReturnedAction(MODULE_NAME, headers.tenantID, headers.chargeBoxIdentity, ServerAction.METER_VALUES, {
            'result': result
          });
          callback({
            'meterValuesResponse': {}
          });
        }).catch((error) => {
          // Log
          Logging.logException(error, ServerAction.METER_VALUES, headers.chargeBoxIdentity,
            MODULE_NAME, 'MeterValues', (headers.tenantID ? headers.tenantID : Constants.DEFAULT_TENANT));
          callback({
            'meterValuesResponse': {}
          });
        });
      },

      StartTransaction: function(args, callback, headers, req) {
        // Check SOAP params
        Utils.normalizeAndCheckSOAPParams(headers, req).then(async () => {
          // Log
          Logging.logReceivedAction(MODULE_NAME, headers.tenantID, headers.chargeBoxIdentity, ServerAction.START_TRANSACTION, [ headers, args ]);
          // Handle
          const result = await global.centralSystemSoap.getChargingStationService(OCPPVersion.VERSION_16).handleStartTransaction(headers, args);
          // Log
          Logging.logReturnedAction(MODULE_NAME, headers.tenantID, headers.chargeBoxIdentity, ServerAction.START_TRANSACTION, {
            'result': result
          });
          callback({
            'startTransactionResponse': {
              'transactionId': result.transactionId,
              'idTagInfo': {
                'status': result.status
              }
            }
          });
        }).catch((error) => {
          // Log
          Logging.logException(error, ServerAction.START_TRANSACTION, headers.chargeBoxIdentity,
            MODULE_NAME, 'StartTransaction', (headers.tenantID ? headers.tenantID : Constants.DEFAULT_TENANT));
          callback({
            'startTransactionResponse': {
              'transactionId': 0,
              'idTagInfo': {
                'status': 'Invalid'
              }
            }
          });
        });
      },

      StatusNotification: function(args, callback, headers, req) {
        // Check SOAP params
        Utils.normalizeAndCheckSOAPParams(headers, req).then(async () => {
          // Log
          Logging.logReceivedAction(MODULE_NAME, headers.tenantID, headers.chargeBoxIdentity, ServerAction.STATUS_NOTIFICATION, [ headers, args ]);
          // Handle
          const result = await global.centralSystemSoap.getChargingStationService(OCPPVersion.VERSION_16).handleStatusNotification(headers, args);
          // Log
          Logging.logReturnedAction(MODULE_NAME, headers.tenantID, headers.chargeBoxIdentity, ServerAction.STATUS_NOTIFICATION, {
            'result': result
          });
          callback({
            'statusNotificationResponse': {}
          });
        }).catch((error) => {
          // Log
          Logging.logException(error, ServerAction.STATUS_NOTIFICATION, headers.chargeBoxIdentity,
            MODULE_NAME, 'StatusNotification', (headers.tenantID ? headers.tenantID : Constants.DEFAULT_TENANT));
          // Default
          callback({
            'statusNotificationResponse': {}
          });
        });
      },

      StopTransaction: function(args, callback, headers, req) {
        // Check SOAP params
        Utils.normalizeAndCheckSOAPParams(headers, req).then(async () => {
          // Log
          Logging.logReceivedAction(MODULE_NAME, headers.tenantID, headers.chargeBoxIdentity, ServerAction.STOP_TRANSACTION, [ headers, args ]);
          // Handle
          const result = await global.centralSystemSoap.getChargingStationService(OCPPVersion.VERSION_16).handleStopTransaction(headers, args);
          // Log
          Logging.logReturnedAction(MODULE_NAME, headers.tenantID, headers.chargeBoxIdentity, ServerAction.STOP_TRANSACTION, {
            'result': result
          });
          callback({
            'stopTransactionResponse': {
              'idTagInfo': {
                'status': result.status
              }
            }
          });
        }).catch((error) => {
          // Log
          Logging.logException(error, ServerAction.STOP_TRANSACTION, headers.chargeBoxIdentity,
            MODULE_NAME, 'StopTransaction', (headers.tenantID ? headers.tenantID : Constants.DEFAULT_TENANT));
          callback({
            'stopTransactionResponse': {
              'idTagInfo': {
                'status': 'Invalid'
              }
            }
          });
        });
      }
    }
  }
};

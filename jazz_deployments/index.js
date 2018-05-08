// =========================================================================
// Copyright © 2017 T-Mobile USA, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// =========================================================================

/**
  Nodejs Template Project
  @author: 
  @version: 1.0
**/

const errorHandlerModule = require("./components/error-handler.js"); //Import the error codes module.
const responseObj = require("./components/response.js"); //Import the response module.
const configObj = require("./components/config.js"); //Import the environment data.
const logger = require("./components/logger.js"); //Import the logging module.
const utils = require("./components/utils.js")(); //Import the utils module.
const validateUtils = require("./components/validation")(); //Import validation module
const crud = require("./components/crud")(); //Import the crud module.
const request = require('request');
const util = require('util');

module.exports.handler = (event, context, cb) => {

	//Initializations
	var errorHandler = errorHandlerModule(),
		config = configObj(event);
	global.config = config;
	logger.init(event, context);

	//validate inputs
	if (!event || !event.method) {
		return cb(JSON.stringify(errorHandler.throwInternalServerError("Service inputs not defined!")));
	}
	logger.info(event);
	var deploymentTableName = config.DEPLOYMENT_TABLE,
		queryParams = null,
		deploymentId = null,
		method = event.method,
		query = event.query,
		path = event.path,
		body = event.body;

	if (method === "POST" && !Object.keys(event.path).length) {
		var deployment_details = body;
		// creating new deployment details
		validateDeploymentDetails(config, deployment_details)
			.then(() => addNewDeploymentDetails(deployment_details, deploymentTableName))
			.then((res) => {
				logger.info("Create deployment result:" + JSON.stringify(res));
				return cb(null, responseObj(res, deployment_details));
			})
			.catch((error) => {
				logger.error("Error while creating new deployment:" + JSON.stringify(error));
				if (error.result == "inputError") {
					return cb(JSON.stringify(errorHandler.throwInputValidationError(error.message)));
				} else {
					return cb(JSON.stringify(errorHandler.throwInternalServerError("unexpected error occurred")));
				}
			});
	}

	if (method === "POST" && Object.keys(event.path).length) {

		deploymentId = path.id;
		logger.info("GET Deployment details using deployment Id :" + deploymentId);
		if (!deploymentId) {
			return cb(JSON.stringify(errorHandler.throwInternalServerError("Missing input parameter deployment id")));
		}

		// write reuest to get authtoken using login api and config provided user details and provide "baseAuthToken" value to rebuild request
		getDeploymentDetailsById(deploymentTableName, deploymentId)
			.then((res) => reBuildDeployment(res, config))
			.then((res) => {
				logger.info("Re-build result:" + JSON.stringify(res));
				return cb(null, responseObj(res, path));
			})
			.catch((error) => {
				logger.error("Re-build error:" + JSON.stringify(error));
				if (error.result.toLowerCase() === "notfound" || error.result === "deployment_already_deleted_error") {
					return cb(JSON.stringify(errorHandler.throwNotFoundError(error.message)));
				} else {
					return cb(JSON.stringify(errorHandler.throwInternalServerError('unhandled error occurred')));
				}
			});
	}

	if (method === 'GET' && query && utils.isEmpty(path)) {
		queryParams = {
			'service': query.service,
			'domain': query.domain,
			'environment': query.environment,
			'status': query.status,
			'offset': query.offset,
			'limit': query.limit
		};

		// GET Deployment details using query params
		validateQueryParams(config, queryParams)
			.then(() => getDeploymentDetailsByQueryParam(deploymentTableName, queryParams))
			.then((res) => {
				logger.info("Get list of deployments:" + JSON.stringify(res));
				return cb(null, responseObj(res, query));
			})
			.catch((error) => {
				logger.error("Error while fetching deployments:" + JSON.stringify(error));
				if (error.result === "inputError") {
					return cb(JSON.stringify(errorHandler.throwInputValidationError(error.message)));
				} else {
					return cb(JSON.stringify(errorHandler.throwInternalServerError("unexpected error occurred")));
				}
			});
	}

	if (method === 'GET' && path && utils.isEmpty(query)) {
		deploymentId = path.id;
		if (!deploymentId) {
			return cb(JSON.stringify(errorHandler.throwInternalServerError("Missing input parameter deployment id")));
		}
		// GET Deployment details using deployment Id
		getDeploymentDetailsById(deploymentTableName, deploymentId)
			.then((res) => {
				logger.info("Get Success. " + JSON.stringify(res));
				return cb(null, responseObj(res, path));
			})
			.catch((error) => {
				logger.error("Error occurred. " + JSON.stringify(error));
				if ((error.result === "notFound") || (error.result === "deployment_already_deleted_error")) {
					return cb(JSON.stringify(errorHandler.throwNotFoundError(error.message)));
				} else {
					return cb(JSON.stringify(errorHandler.throwInternalServerError("unexpected error occurred")));
				}
			});
	}

	if (method === "PUT" && path) {
		var update_deployment_data = {},
			unchangeable_fields = config.REQUIRED_PARAMS, // list of fields that cannot be updated
			invalid_environment_fields = [];
		deploymentId = path.id;

		if (!deploymentId) {
			return cb(JSON.stringify(errorHandler.throwInternalServerError("Missing input parameter deployment id")));
		}

		// Update deployments details by id
		validateUpdateInput(config, body, deploymentTableName, deploymentId)
			.then((data) => updateDeploymentDetails(deploymentTableName, data, deploymentId))
			.then((res) => {
				logger.info("Updated data:" + JSON.stringify(res));
				return cb(null, responseObj({
					message: "Successfully Updated deployment details with id: " + deploymentId
				}, body));
			})
			.catch((error) => {
				logger.error("Error occurred."+JSON.stringify(error));
				if (error.result === "inputError") {
					return cb(JSON.stringify(errorHandler.throwInputValidationError(error.message)));
				} else if (error.result === "notFound") {
					return cb(JSON.stringify(errorHandler.throwNotFoundError(error.message)));
				} else {
					return cb(JSON.stringify(errorHandler.throwInternalServerError("unexpected error occurred")));
				}
			});
	}

	if (method === "DELETE" && path) {
		deploymentId = path.id;
		if (!deploymentId) {
			return cb(JSON.stringify(errorHandler.throwInternalServerError("Missing input parameter deployment id")));
		}
		// Deleting deployment details for id
		getDeploymentDetailsById(deploymentTableName, deploymentId)
			.then((res) => deleteServiceByID(res, deploymentTableName, deploymentId))
			.then((res) => {
				logger.info("DeleteItem succeeded");
				var msg = "Successfully Deleted deployment details of id :" + deploymentId;
				return cb(null, responseObj({
					message: msg
				}, path));
			})
			.catch((error) => {
				logger.error("Error in DeleteItem: " + JSON.stringify(error));
				if (error.result === "deployment_already_deleted_error" || error.result === "notFound") {
					return cb(JSON.stringify(errorHandler.throwNotFoundError(error.message)));
				} else {
					return cb(JSON.stringify(errorHandler.throwInternalServerError("unexpected error occurred ")));
				}
			});
	}

};

function validateDeploymentDetails(config, deployment_details) {
	logger.info("validateDeploymentDetails for creating new deployment");
	return new Promise((resolve, reject) => {
		validateUtils.validateCreatePayload(config, deployment_details, (error, data) => {
			if (error) {
				logger.error("validateDeploymentDetails error:" + JSON.stringify(error));
				reject(error);
			} else {
				resolve(data);
			}
		});
	});
}

function addNewDeploymentDetails(deployment_details, deploymentTableName) {
	logger.info("addNewDeploymentDetails");
	return new Promise((resolve, reject) => {
		crud.create(deployment_details, deploymentTableName, (error, data) => {
			if (error) {
				logger.error("addNewDeploymentDetails error:" + JSON.stringify(error));
				reject(error);
			} else {
				resolve(data);
			}
		});
	});
}

function validateQueryParams(config, params) {
	logger.info("validateQueryParams for deployments");
	return new Promise((resolve, reject) => {
		validateUtils.validateDeployment(config, params, (error, data) => {
			if (error) {
				logger.error("validateQueryParams error:" + JSON.stringify(error));
				reject(error);
			} else {
				resolve(data);
			}
		});
	});
}

function getDeploymentDetailsByQueryParam(deploymentTableName, queryParams) {
	logger.info("getDeploymentDetailsByQueryParam" + JSON.stringify(queryParams));
	return new Promise((resolve, reject) => {
		crud.getList(deploymentTableName, queryParams, (error, data) => {
			if (error) {
				logger.error("getDeploymentDetailsByQueryParam error:" + JSON.stringify(error));
				reject(error);
			} else {
				resolve(data);
			}
		});
	});
}

function getDeploymentDetailsById(deploymentTableName, deploymentId) {
	logger.info("getDeploymentDetailsById" + JSON.stringify(deploymentId));
	return new Promise((resolve, reject) => {
		crud.get(deploymentTableName, deploymentId, (error, data) => {
			if (error) {
				logger.error("getDeploymentDetailsById error:" + JSON.stringify(error));
				reject(error);
			} else {
				if (data && !(Object.keys(data).length && data.constructor === Object)) {
					logger.error('Cannot find deployment details with id : ' + deploymentId);
					reject({
						result: "notFound",
						message: 'Cannot find deployment details with id :' + deploymentId
					});
				} else {
					resolve(data);
				}
			}
		});
	});
}

function validateUpdateInput(config, update_data, deploymentTableName, deploymentId) {
	logger.info("validateUpdateInput");
	return new Promise((resolve, reject) => {
		validateUtils.validateUpdatePayload(config, update_data, deploymentTableName, deploymentId, (error, data) => {
			if (error) {
				logger.error("validateUpdateInput error:" + JSON.stringify(error));
				reject(error);
			} else {
				resolve(data);
			}
		})
	})
}

function updateDeploymentDetails(deploymentTableName, update_deployment_data, deploymentId) {
	logger.info("updateDeploymentDetails");
	return new Promise((resolve, reject) => {
		crud.update(update_deployment_data, deploymentTableName, deploymentId, (error, data) => {
			if (error) {
				logger.error("updateDeploymentDetails error:" + JSON.stringify(error));
				reject(error);
			} else {
				resolve(data);
			}
		});
	})
}

function deleteServiceByID(getDeploymentDetails, deploymentTableName, deploymentId) {
	logger.info("deleteServiceByID" + JSON.stringify(getDeploymentDetails));
	return new Promise((resolve, reject) => {
		if (!utils.isEmpty(getDeploymentDetails)) {
			crud.delete(deploymentTableName, deploymentId, (error, data) => {
				if (error) {
					logger.error("deleteServiceByID error:" + JSON.stringify(error));
					reject(error);
				} else {
					resolve(data);
				}
			});
		} else {
			reject({
				result: "notFound",
				message: "Deployment with provided Id is not available"
			})
		}
	})
}

function reBuildDeployment(refDeployment, config) {
	logger.info("Inside reBuildDeployment"+JSON.stringify(refDeployment));
	return new Promise((resolve, reject) => {
		getToken(config)
			.then((authToken) => getServiceDetails(config, refDeployment.service_id, authToken))
			.then((res) => buildNowRequest(res, config, refDeployment))
			.then((res) => {
				resolve(res);
			})
			.catch((error) => {
				reject(error);
			})

	});
}

function getToken(configData) {
	return new Promise((resolve, reject) => {
		var svcPayload = {
			uri: configData.SERVICE_API_URL + configData.TOKEN_URL,
			method: 'post',
			json: {
				"username": configData.SERVICE_USER,
				"password": configData.TOKEN_CREDS
			},
			rejectUnauthorized: false
		};
		request(svcPayload, (error, response, body) => {
			if (response.statusCode === 200 && body && body.data) {
				var authToken = body.data.token;
				resolve(authToken);
			} else {
				reject({
					"error": "Could not get authentication token for updating service catalog.",
					"message": response.body.message
				});
			}
		});
	});
}

function getServiceDetails(configData, serviceId, authToken) {
	logger.info("getServiceDetails:"+serviceId)
	return new Promise((resolve, reject) => {
		var params = {
			uri: configData.SERVICE_API_URL + configData.SERVICE_API_RESOURCE + "/" + serviceId,
			method: 'get',
			headers: {
				'Authorization': authToken
			},
			rejectUnauthorized: false
		};
		request(params, (error, response, body) => {			
			if (error) {
				reject(error);
			} else {
				resolve(response.body);
			}
		});
	});
}

function buildNowRequest(serviceDetails, config, refDeployment) {
	logger.info("buildNowRequest:")
	return new Promise((resolve, reject) => {
		var service=JSON.parse(serviceDetails),
		data=service.data,
		service_name = data.service,
		domain = data.domain,
		scm_branch = refDeployment.scm_branch,
		build_url = config.JOB_BUILD_URL,
		buildQuery = "/buildWithParameters?service_name=" + service_name + "&domain=" + domain + "&scm_branch=" + scm_branch,
		base_auth_token = "Basic " + new Buffer(util.format("%s:%s", config.SVC_USER, config.SVC_PASWD)).toString("base64"),
		rebuild_url = "";

		if (data.type.toLowerCase() === 'api') {
			rebuild_url = build_url + "build_pack_api" + buildQuery;
		} else if (data.type.toLowerCase() === 'lambda') {
			rebuild_url = build_url + "build_pack_lambda" + buildQuery;
		} else if (data.type.toLowerCase() === 'website') {
			rebuild_url = build_url + "build_pack_website" + buildQuery;
		}

		if (build_url) {
			var options = {
				url: rebuild_url,
				method: 'POST',
				rejectUnauthorized: false,
				headers: {
					'Accept': 'application/json',
					'Authorization': base_auth_token
				}
			};
			request(options, function (error, res, body) {
				if (error) {
					logger.error("Unable to rebuild deployment :" + error);
					reject(error);
				} else {
					// Success response
					if (res.statusCode === 200 || res.statusCode === 201) {
						logger.info("successfully deployment started.");
						resolve({
							result: 'success',
							message: "deployment started."
						});
					} else if (res.statusCode === 404) {
						logger.info("Service not available.");
						var msg = 'Unable to re-build ' + service_name + ' as requested service is unavailable.';
						reject({
							result: "notFound",
							message: msg
						});
					} else {
						reject("unknown error occurred");
					}
				}
			});
		} else {
			reject("unable to find deployment details");
		}
	});
}
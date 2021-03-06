@Formula_data = {}

#PK userId + spaceId
Formula_data._spaceUsers = {}

#PK orgId
Formula_data._orgs = {}

_getOrgsData = (spaceId, orgIds)->
	data = {'spaceId' : spaceId,'orgIds' : orgIds}

	data = JSON.stringify(data);

	result = {}

	param = {}

	param["X-User-Id"] = Meteor.userId();
	param["X-Auth-Token"] = Accounts._storedLoginToken();

	$.ajax({
		url: Steedos.absoluteUrl('/api/formula/orgs?' + $.param(param)),
		type: 'POST',
		async: false,
		data: data,
		dataType: 'json',
		processData: false,
		contentType: "application/json",
		success: (responseText, status) ->
			if (responseText.errors)
				console.error(responseText.errors);
				return;
			result = responseText.orgs;
		error: (xhr, msg, ex) ->
			console.error(msg);
	});

	return result

_getUsersData = (spaceId, userIds)->

	data = {'spaceId' : spaceId,'userIds' : userIds}

	data = JSON.stringify(data);

	result = {}

	param = {}

	param["X-User-Id"] = Meteor.userId();
	param["X-Auth-Token"] = Accounts._storedLoginToken();

	$.ajax({
			url: Steedos.absoluteUrl('/api/formula/users?' + $.param(param)),
			type: 'POST',
			async: false,
			data: data,
			dataType: 'json',
			processData: false,
			contentType: "application/json",
			success: (responseText, status) ->
				if (responseText.errors)
					console.error(responseText.errors);
					return;
				result = responseText.spaceUsers;
			error: (xhr, msg, ex) ->
				console.error(msg);
	});

	return result

_convertSpaceUser = (u)->
	if u instanceof Array
		user = {}
		user.name = u.getProperty('name')
		user.organization = {}
		user.organization.name = u.getProperty('organization').getProperty('name')
		user.organization.fullname = u.getProperty('organization').getProperty('fullname')
		user.company = {}
		user.company.name = u.getProperty('company').getProperty('name')
		user.company.code = u.getProperty('company').getProperty('code')
		user.hr = u.getProperty('hr')
		user.sort_no = u.getProperty('sort_no')
		user.mobile = u.getProperty('mobile')
		user.work_phone = u.getProperty('work_phone')
		user.position = u.getProperty('position')
		userRoles = u.getProperty('roles')
		roles = new Array
		userRoles.forEach (i) ->
			roles = roles.concat(i)
			return
		roles.uniq()
		user.roles = roles
		user
	else
		u

_convertOrg = (o)->
	if o instanceof Array
		org = {}
		org.id = o.getProperty('_id')
		org.name = o.getProperty('name')
		org.fullname = o.getProperty('fullname')
		org
	else
		o

Formula_data.getUsers = (spaceId, userIds)->
	if _.isArray(userIds)

		#??????????????????????????????
		noCatchUserIds = []
		_.each userIds, (userId)->
			pk = spaceId + "_" + userId
			if !Formula_data._spaceUsers[pk]
				noCatchUserIds.push userId

		#??????????????????userId??????????????????????????????
		if noCatchUserIds.length > 0
			data = _getUsersData(spaceId, noCatchUserIds)
			_.each data, (item)->
				pk = spaceId + "_" + item.id
				Formula_data._spaceUsers[pk] = item
		u = []
		_.each userIds, (userId)->
			u.push Formula_data.getUser(spaceId, userId)
	else
		u = Formula_data.getUser(spaceId, userIds)
	return _convertSpaceUser(u)

Formula_data.getUser = (spaceId, userId)->
	if !spaceId || !userId
		return
	pk = spaceId + "_" + userId
	catch_data = Formula_data._spaceUsers[pk]
	if catch_data
		return catch_data
	else
		data = _getUsersData(spaceId, userId)
		if data
			Formula_data._spaceUsers[pk] = data
			return data
		else
			console.error("???????????????")

Formula_data.getOrgs = (spaceId, orgIds)->
	if _.isArray(orgIds)

		#??????????????????????????????
		noCatchOrg = []
		_.each orgIds, (orgId)->
			pk = orgId
			if !Formula_data._orgs[pk]
				noCatchOrg.push orgId

		#??????????????????org??????????????????????????????
		if noCatchOrg.length > 0
			data = _getOrgsData(spaceId, noCatchOrg)
			_.each data, (item)->
				pk = item.id
				Formula_data._orgs[pk] = item

		o = []
		_.each orgIds, (orgId)->
			o.push Formula_data.getOrg(spaceId, orgId)
	else
		o = Formula_data.getOrg(spaceId, orgIds)
	return _convertOrg(o)

Formula_data.getOrg = (spaceId, orgId)->
	if !spaceId || !orgId
		return
	pk = orgId
	catch_data = Formula_data._orgs[pk]
	if catch_data
		return catch_data
	else
		data = _getOrgsData(spaceId, orgId)
		if data
			Formula_data._orgs[pk] = data
			return data
		else
			console.error("???????????????")

Formula_data.getInstanceValues = (fields, autoFormDoc, approver, applicant, spaceId)->
	__values = {};
	if fields && fields.length && autoFormDoc
		fields.forEach ((field) ->
			type = field.type
			if type
				if type == 'table'

					###
					* ??????????????????????????????????????????__values???
					* values????????????????????????
					* [{"a":1,"b":4},{"a":2,"b":5},{"a":3,"b":6}]
					* __values??????????????????????????????????????????????????????????????????
					* {"a":[1,2,3],"b":[4,5,6]}
					*
					###

					tableFields = field.sfields
					tableValues = autoFormDoc[field.code]
					formulaTableValues = []
					__tableValues = {}
					#??????????????????????????????__tableValues
					if tableFields and tableFields.length and tableValues and tableValues instanceof Array
						tableValues.forEach ((tableValue) ->
							formulaTableValues.push Form_formula.init_formula_values(tableFields, tableValue)
							return
						), this
						#????????????????????????__tableValues??????
						tableFields.forEach (tablefield) ->
							__tableValues[tablefield.code] = formulaTableValues.getEach(tablefield.code)
							return
						__values = Form_formula.mixin(__values, __tableValues)
				else if type == 'user'
					__values[field.code] = Formula_data.getUsers(spaceId, autoFormDoc[field.code])
				else if type == 'group'
					__values[field.code] = Formula_data.getOrgs(spaceId, autoFormDoc[field.code])
				else if type == 'odata'
					__values[field.code] = autoFormDoc[field.code] || {}
				else
					__values[field.code] = autoFormDoc[field.code]
			return
		), this

	#???????????????
	__values["approver"] = Formula_data.getUser(spaceId, approver);
	#?????????
	__values["applicant"] = Formula_data.getUser(spaceId, applicant);

	return __values

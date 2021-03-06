const objectql = require('@steedos/objectql');
const _ = require('underscore');
const moment = require(`moment`);

const caculateAutonumber = async function (objectName, fieldName, formula, spaceId) {
    var padding = function (num, length) {
        var len = (num + "").length;
        var diff = length - len;
        if (diff > 0) {
            return Array(diff + 1).join("0") + num;
        }
        return num;
    };
    var anColl = objectql.getObject('autonumber');
    var date_from, date_to;
    var selector = {
        object_name: objectName,
        field_name: fieldName,
        space: spaceId
    };
    var m = moment();
    var yyyy = m.format('YYYY'),
        yy = m.format('YY'),
        mm = m.format('MM'),
        dd = m.format('DD');
    var hasYear = formula.indexOf('{YYYY}') > -1;
    var hasMonth = formula.indexOf('{MM}') > -1;
    var hasDay = formula.indexOf('{DD}') > -1;
    if (hasYear && hasMonth && hasDay) {
        date_from = m.startOf("day").toDate();
        date_to = m.endOf("day").toDate();
    } else if (hasYear && hasMonth) {
        date_from = m.startOf("month").toDate();
        date_to = m.endOf("month").toDate();
    } else if (hasYear) {
        date_from = m.startOf("year").toDate();
        date_to = m.endOf("year").toDate();
    }
    if (date_from && date_to) {
        selector.date_from = date_from;
        selector.date_to = date_to;
    } else {
        selector.date_from = null;
        selector.date_to = null;
    }

    const filters = [];

    for (const key in selector) {
        filters.push([key, '=', selector[key]]);
    }
    var anData = null;
    var records = await anColl.find({ filters });
    if (records && records.length > 0) {
        anData = records[0];
    }
    var anId;
    if (anData) {
        anId = anData._id;
        await anColl.directUpdate(anId, {
            $inc: {
                current_no: 1
            }
        });
    } else {
        anId = await anColl._makeNewID();
        var insertObj = {
            _id: anId,
            object_name: objectName,
            field_name: fieldName,
            space: spaceId
        };
        if (date_from && date_to) {
            insertObj.date_from = date_from;
            insertObj.date_to = date_to;
        }
        await anColl.directInsert(insertObj);
    }
    var {current_no: currentNo} = await anColl.findOne(anId);
    var numberFormatMethod = function ($1) {
        return padding(currentNo, $1.length - 2);
    };
    var autonumber = formula.replace(/{YYYY}/g, yyyy).replace(/{YY}/g, yy).replace(/{MM}/g, mm).replace(/{DD}/g, dd).replace(/{[0]+}/g, numberFormatMethod);
    return autonumber;
};

module.exports = {
    listenTo: 'base',
    afterInsert: async function () {
        const { doc, object_name } = this;
        const spaceId = doc.space;
        if (!spaceId) {
            return;
        }
        var obj, fields, setObj = {};
        obj = objectql.getObject(object_name);
        fields = await obj.getFields();

        for (const k in fields) {
            const f = fields[k];
            if (f.type == 'autonumber' && f.formula) {
                setObj[k] = await caculateAutonumber(object_name, k, f.formula, spaceId);
            }
        }
        if (!_.isEmpty(setObj)) {
            await objectql.getObject(object_name).directUpdate(doc._id, setObj);
        }
    }
}
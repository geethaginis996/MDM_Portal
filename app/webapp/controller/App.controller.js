sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], function (Controller, JSONModel, Filter, FilterOperator) {
    "use strict";

    // Maps route key → breadcrumb text shown in ShellBar secondTitle
    var mRouteLabels = {
        fieldMaster: "Configuration \u203a Field Master",
        fieldGroups: "Configuration \u203a Field Groups",
        valueTables: "Configuration \u203a Value Tables",
        validationRules: "Configuration \u203a Validation Rules",
        bpRoles: "BP Configuration \u203a BP Roles",
        bpCategories: "BP Configuration \u203a BP Categories",
        accountGroups: "BP Configuration \u203a Account Groups",
        releaseCodes: "Release Management \u203a Release Codes",
        releaseStrategies: "Release Management \u203a Release Strategies",
        myRequests: "Change Requests \u203a My Requests",
        approvalInbox: "Change Requests \u203a Approval Inbox",
        help: "Help",
        appSettings: "Settings"
    };

    return Controller.extend("mdm.portal.controller.App", {

        onInit: function () {
            var oUiModel = new JSONModel({
                pendingApprovals: 0,
                shellBreadcrumb: "Configuration \u203a Field Master"
            });
            this.getView().setModel(oUiModel, "ui");
            this._loadPendingApprovalCount();

            // Correct the content margin after initial render
            setTimeout(function () {
                this._adjustContentWidth();
                this._fixClipPath();
            }.bind(this), 500);

            setTimeout(function () {
                var oToolPage = this.byId("toolPage");
                if (!oToolPage) return;
                var oToolPageDom = oToolPage.getDomRef();
                if (!oToolPageDom) return;

                var oWrapper = oToolPageDom.querySelector(
                    "[id$='fieldMasterPage-contentWrapper']"
                );
                if (!oWrapper) return;

                // MutationObserver watches inline style changes and removes clip-path
                var oObserver = new MutationObserver(function () {
                    if (oWrapper.style.clipPath && oWrapper.style.clipPath !== "none") {
                        oWrapper.style.clipPath = "none";
                        oWrapper.style.overflow = "auto";
                    }
                });

                oObserver.observe(oWrapper, {
                    attributes: true,
                    attributeFilter: ["style"]
                });

                this._oClipPathObserver = oObserver;
            }.bind(this), 600);
        },
        _adjustContentWidth: function () {
            var oToolPage = this.byId("toolPage");
            if (!oToolPage) return;
            var oToolPageDom = oToolPage.getDomRef();
            if (!oToolPageDom) return;

            var oSideContent = oToolPageDom.querySelector(".sapTntToolPageSideContent");
            var oMainContent = oToolPageDom.querySelector(".sapTntToolPageMainContent");
            if (!oMainContent) return;

            var iSideWidth = oSideContent
                ? oSideContent.getBoundingClientRect().width : 0;

            oMainContent.style.marginLeft = iSideWidth + "px";
            oMainContent.style.width = "calc(100% - " + iSideWidth + "px)";

            // Fire resize so SAP Table re-evaluates demandPopin columns
            window.dispatchEvent(new Event("resize"));

            // Also invalidate the table control to force column recalculation
            var oNavContainer = this.byId("appPages");
            if (oNavContainer) {
                var oPage = oNavContainer.getCurrentPage();
                if (oPage) {
                    var oTable = oPage.byId
                        ? oPage.byId("fieldTable")
                        : sap.ui.getCore().byId("__xmlview0--fieldTable");
                    if (oTable) {
                        oTable.invalidate();
                    }
                }
            }
        },

        // ── Pending approval count (OData v4 safe) ─────────────────────
        _loadPendingApprovalCount: function () {
            var oModel = this.getOwnerComponent().getModel();

            var oBinding = oModel.bindList("/ApprovalItems", null, null, null, {
                $count: true
            });
            oBinding.filter(new Filter("status", FilterOperator.EQ, "PENDING"));

            oBinding.requestContexts(0, 1)
                .then(function () {
                    return oBinding.getHeaderContext().requestProperty("$count");
                })
                .then(function (iCount) {
                    this.getView().getModel("ui")
                        .setProperty("/pendingApprovals", iCount || 0);
                }.bind(this))
                .catch(function (oErr) {
                    console.warn("Could not load pending approvals", oErr);
                });
        },

        // ── ShellBar breadcrumb helper ──────────────────────────────────
        _setShellBreadcrumb: function (sKey) {
            var sLabel = mRouteLabels[sKey] || sKey;
            this.getView().getModel("ui").setProperty("/shellBreadcrumb", sLabel);
        },
        // ── Navigation item select ──────────────────────────────────────
        onNavItemSelect: function (oEvent) {
            var oItem = oEvent.getParameter("item");
            if (!oItem) return;

            var sKey = oItem.getKey();
            if (sKey) {
                this._setShellBreadcrumb(sKey);
                this.getOwnerComponent().getRouter().navTo(sKey);
            }

            // Auto-collapse on Phone after selection
            if (sap.ui.Device.system.phone) {
                this.byId("toolPage").setSideExpanded(false);
            }
        },
        onSideNavToggle: function () {
            var oToolPage = this.byId("toolPage");
            oToolPage.setSideExpanded(!oToolPage.getSideExpanded());

            // Wait for SAP animation to finish then remeasure
            setTimeout(function () {
                this._adjustContentWidth();
                this._fixClipPath();
            }.bind(this), 300);
        },
        // ── Remove SAP's clip-path inline style that hides content ──────
        _fixClipPath: function () {
            var oToolPage = this.byId("toolPage");
            if (!oToolPage) return;
            var oToolPageDom = oToolPage.getDomRef();
            if (!oToolPageDom) return;

            var oWrapper = oToolPageDom.querySelector(
                "[id$='fieldMasterPage-contentWrapper']"
            );
            if (oWrapper) {
                oWrapper.style.clipPath = "none";
                oWrapper.style.overflow = "auto";
            }
        },
        // ── ShellBar search icon pressed ────────────────────────────────
        onSearchOpen: function () {
            // ShellBar handles its own search overlay; stub for custom logic
        },

        // ── Notifications ───────────────────────────────────────────────
        onNotificationsPress: function () {
            // TODO: open NotificationsPopover
        },
        onExit: function () {
            if (this._oClipPathObserver) {
                this._oClipPathObserver.disconnect();
            }
        },
        // ── User avatar / profile ───────────────────────────────────────
        onAvatarPress: function () {
            // TODO: open user menu Popover
        }
    });
});
